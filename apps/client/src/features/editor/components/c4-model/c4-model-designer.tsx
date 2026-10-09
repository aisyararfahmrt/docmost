import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  InputLabel,
  Modal,
  SegmentedControl,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { useTranslation } from "react-i18next";
import {
  IconArrowsMaximize,
  IconDeviceFloppy,
  IconLink,
  IconLinkOff,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  C4ArrowType,
  C4ContainerElem,
  C4Elem,
  C4ElementKind,
  C4ModelData,
  C4Relation,
  C4Scope,
} from "@docmost/editor-ext";
import {
  BoundaryBox,
  C4SvgElement,
  C4SvgRelationHandles,
  C4SvgRelations,
  closestSegment,
  contentBounds,
  pointAlong,
  polylineClosest,
  polylineInterior,
  routedPointsFor,
  type Pt,
} from "./c4-diagram";
import {
  elementSize,
  genId,
  isDrillable,
  kindLabel,
  PALETTE,
  parseModel,
  type C4Level,
  type PaletteItem,
} from "./c4-model-utils";

type DrillPath = "context" | "containerScope" | string;

interface DesignerProps {
  opened: boolean;
  onClose: () => void;
  initialData: string;
  isEditable: boolean;
  onSave: (data: {
    data: string;
    name: string;
    description: string;
  }) => void;
}

const SCOPE_PAD = 40;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findElement(model: C4ModelData, id: string): C4Elem | undefined {
  for (const el of model.context.elements) if (el.id === id) return el;
  for (const el of model.containerScope.elements) if (el.id === id) return el;
  for (const cont of model.containerScope.elements) {
    for (const c of cont.componentScope.elements) if (c.id === id) return c;
  }
  return undefined;
}

function findRelation(model: C4ModelData, id: string): C4Relation | undefined {
  for (const r of model.context.relations) if (r.id === id) return r;
  for (const r of model.containerScope.relations) if (r.id === id) return r;
  for (const c of model.containerScope.elements) {
    const found = c.componentScope.relations.find((r) => r.id === id);
    if (found) return found;
  }
  return undefined;
}

export function C4ModelDesigner({
  opened,
  onClose,
  initialData,
  isEditable,
  onSave,
}: DesignerProps) {
  const { t } = useTranslation();
  const [model, setModel] = useState<C4ModelData>(() =>
    parseModel(initialData),
  );
  const [dirty, setDirty] = useState(false);
  const [drill, setDrill] = useState<DrillPath>("context");
  const [selected, setSelected] = useState<{
    kind: "element" | "relation";
    id: string;
  } | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [drag, setDrag] = useState<{
    id: string;
    moved: boolean;
    startX: number;
    startY: number;
    elStartX: number;
    elStartY: number;
  } | null>(null);
  const [pan, setPan] = useState<{
    startClientX: number;
    startClientY: number;
    startViewX: number;
    startViewY: number;
    moved: boolean;
  } | null>(null);
  const [interact, setInteract] = useState<null | {
    kind: "anchor" | "label" | "line";
    relId: string;
    end?: "from" | "to";
    elId?: string;
    basePts: Pt[];
    segIndex?: number;
    axis?: "h" | "v";
    segBase?: number;
    sx?: number;
    sy?: number;
  }>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const modelRef = useRef(model);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    if (opened) {
      setModel(parseModel(initialData));
      setDirty(false);
      setDrill("context");
      setSelected(null);
      setConnectMode(false);
      setConnectSource(null);
      setView({ x: 0, y: 0, scale: 1 });
      setDrag(null);
      setPan(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, initialData]);

  const currentScope = useMemo<C4Scope>(() => {
    if (drill === "context") return model.context;
    if (drill === "containerScope") return model.containerScope;
    const container = model.containerScope.elements.find(
      (c) => c.id === drill,
    );
    return container ? container.componentScope : model.context;
  }, [model, drill]);

  const currentLevel: C4Level =
    drill === "context" ? "context" : drill === "containerScope" ? "container" : "component";

  const boundaryLabel =
    drill === "containerScope"
      ? model.name
      : drill !== "context"
        ? findElement(model, drill)?.name || "Container"
        : null;

  const scopeElements = currentScope.elements as C4Elem[];
  const bounds = useMemo(
    () => contentBounds(scopeElements, currentScope.relations),
    [scopeElements, currentScope.relations],
  );

  const toContent = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  };

  const commitModel = (next: C4ModelData) => {
    setModel(next);
    setDirty(true);
  };

  const addElement = (kind: C4ElementKind, at?: { x: number; y: number }) => {
    const { w, h } = elementSize(kindLabel(kind));
    const existingCount = currentScope.elements.length;
    const pos = at
      ? { x: at.x, y: at.y }
      : {
          x: ((existingCount % 3) + 1) * 260,
          y: (Math.floor(existingCount / 3) + 1) * 180,
        };
    const id = genId();
    const isContainerKind = kind === "container" || kind === "externalContainer";
    const el: C4Elem = {
      id,
      kind,
      name: kindLabel(kind),
      description: "",
      technology: "",
      x: pos.x,
      y: pos.y,
      w,
      h,
    };
    const next = clone(model);
    if (drill === "context") {
      next.context.elements.push(el);
    } else if (drill === "containerScope") {
      const c: C4ContainerElem = {
        ...el,
        kind: isContainerKind ? (kind as "container" | "externalContainer") : "container",
        componentScope: { elements: [], relations: [] },
      };
      next.containerScope.elements.push(c);
    } else {
      const cont = next.containerScope.elements.find((c) => c.id === drill);
      if (cont) cont.componentScope.elements.push(el);
    }
    commitModel(next);
    setSelected({ kind: "element", id });
  };

  const patchElement = (id: string, patch: Partial<C4Elem>) => {
    const next = clone(model);
    const el = findElement(next, id);
    if (!el) return;
    Object.assign(el, patch);
    const size = elementSize(el.name, el.description, el.technology);
    el.w = size.w;
    el.h = size.h;
    commitModel(next);
  };

  const patchRelation = (id: string, patch: Partial<C4Relation>) => {
    const next = clone(modelRef.current);
    const rel = findRelation(next, id);
    if (!rel) return;
    Object.assign(rel, patch);
    commitModel(next);
  };

  const deleteElement = (id: string) => {
    const next = clone(model);
    const removeFromScope = (scope?: C4Scope) => {
      if (!scope) return;
      scope.elements = scope.elements.filter((e) => e.id !== id);
      scope.relations = scope.relations.filter(
        (r) => r.fromId !== id && r.toId !== id,
      );
    };
    removeFromScope(next.context);
    for (const cont of next.containerScope.elements) {
      removeFromScope(cont.componentScope);
    }
    next.containerScope.elements = next.containerScope.elements.filter(
      (c) => c.id !== id,
    );
    next.containerScope.relations = next.containerScope.relations.filter(
      (r) => r.fromId !== id && r.toId !== id,
    );
    if (drill === id) setDrill("containerScope");
    commitModel(next);
    setSelected(null);
  };

  const deleteRelation = (id: string) => {
    const next = clone(model);
    next.context.relations = next.context.relations.filter((r) => r.id !== id);
    next.containerScope.relations = next.containerScope.relations.filter(
      (r) => r.id !== id,
    );
    for (const c of next.containerScope.elements) {
      c.componentScope.relations = c.componentScope.relations.filter(
        (r) => r.id !== id,
      );
    }
    commitModel(next);
    setSelected(null);
  };

  const addRelation = (fromId: string, toId: string) => {
    const next = clone(model);
    const scope =
      drill === "context"
        ? next.context
        : drill === "containerScope"
          ? next.containerScope
          : next.containerScope.elements.find((c) => c.id === drill)
              ?.componentScope;
    if (!scope) return;
    const already = scope.relations.some(
      (r) => r.fromId === fromId && r.toId === toId,
    );
    if (already || fromId === toId) return;
    scope.relations.push({
      id: genId(),
      fromId,
      toId,
      label: "",
      technology: "",
    });
    commitModel(next);
    setConnectSource(null);
    setSelected({
      kind: "relation",
      id: scope.relations[scope.relations.length - 1].id,
    });
  };

  const drillInto = (id: string) => {
    const el = findElement(model, id);
    if (!el || !isDrillable(el.kind)) return;
    if (drill === "context" && el.kind === "system") {
      setDrill("containerScope");
      setSelected(null);
      setConnectMode(false);
      setConnectSource(null);
      setView({ x: 0, y: 0, scale: 1 });
    } else if (drill === "containerScope" && el.kind === "container") {
      setDrill(id);
      setSelected(null);
      setConnectMode(false);
      setConnectSource(null);
      setView({ x: 0, y: 0, scale: 1 });
    }
  };

  // element drag
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const { x, y } = toContent(e.clientX, e.clientY);
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        setDrag((d) => (d ? { ...d, moved: true } : d));
      }
      setModel((prev) => {
        const next = clone(prev);
        const el = findElement(next, drag.id);
        if (el) {
          el.x = Math.max(0, Math.round(drag.elStartX + dx));
          el.y = Math.max(0, Math.round(drag.elStartY + dy));
        }
        return next;
      });
      setDirty(true);
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  // pan
  useEffect(() => {
    if (!pan) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - pan.startClientX;
      const dy = e.clientY - pan.startClientY;
      if (Math.hypot(dx, dy) > 3) setPan((p) => (p ? { ...p, moved: true } : p));
      setView((v) => ({
        ...v,
        x: pan.startViewX + dx,
        y: pan.startViewY + dy,
      }));
    };
    const onUp = () => setPan(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan]);

  // relation interaction drags (anchor / label / line waypoint)
  useEffect(() => {
    if (!interact) return;
    const onMove = (e: MouseEvent) => {
      const { x, y } = toContent(e.clientX, e.clientY);
      const movedDist =
        interact.sx != null && interact.sy != null
          ? Math.hypot(x - interact.sx, y - interact.sy)
          : Infinity;
      if (movedDist < 4) return;
      if (interact.kind === "anchor") {
        const el = findElement(modelRef.current, interact.elId || "");
        if (!el) return;
        const nx = Math.max(0, Math.min(1, (x - el.x) / el.w));
        const ny = Math.max(0, Math.min(1, (y - el.y) / el.h));
        const key: "fromAnchor" | "toAnchor" =
          interact.end === "from" ? "fromAnchor" : "toAnchor";
        patchRelation(interact.relId, { [key]: { x: nx, y: ny } });
        return;
      }
      if (interact.kind === "label") {
        const t = polylineClosest(interact.basePts, { x, y }).t;
        patchRelation(interact.relId, { labelPos: Math.round(t * 1000) / 1000 });
        return;
      }
      const rel = findRelation(modelRef.current, interact.relId);
      if (!rel) return;
      if (interact.segIndex == null || interact.segBase == null || !interact.axis)
        return;
      const delta =
        interact.axis === "h" ? y - interact.segBase : x - interact.segBase;
      if (Math.abs(delta) < 0.5) return;
      const segIdx = interact.segIndex;
      const np = interact.basePts.map((p, i) =>
        i === segIdx || i === segIdx + 1
          ? interact.axis === "h"
            ? { ...p, y: Math.round(interact.segBase + delta) }
            : { ...p, x: Math.round(interact.segBase + delta) }
          : (p as Pt),
      );
      patchRelation(interact.relId, { waypoints: polylineInterior(np) });
    };
    const onUp = () => setInteract(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interact]);

  const routeForRelation = (relId: string): Pt[] | null =>
    routedPointsFor(currentScope.relations, scopeElements, relId);

  const startAnchorDrag = (relId: string, end: "from" | "to") => {
    const rel = findRelation(model, relId);
    if (!rel) return;
    setSelected({ kind: "relation", id: relId });
    setConnectSource(null);
    setInteract({
      kind: "anchor",
      relId,
      end,
      elId: end === "from" ? rel.fromId : rel.toId,
      basePts: [],
    });
  };

  const startLabelDrag = (relId: string, clientX: number, clientY: number) => {
    const pts = routeForRelation(relId);
    if (!pts) return;
    const { x, y } = toContent(clientX, clientY);
    setSelected({ kind: "relation", id: relId });
    setConnectSource(null);
    setInteract({ kind: "label", relId, basePts: pts, sx: x, sy: y });
  };

  const startGrabDrag = (relId: string, at: Pt) => {
    const pts = routeForRelation(relId);
    if (!pts || pts.length < 2) return;
    const rel = findRelation(model, relId);
    if (!rel) return;
    setSelected({ kind: "relation", id: relId });
    setConnectSource(null);

    // endpoints keep their existing anchor-drag behaviour
    const head = pts[0];
    const tail = pts[pts.length - 1];
    if (Math.hypot(at.x - head.x, at.y - head.y) < 12) {
      startAnchorDrag(relId, "from");
      return;
    }
    if (Math.hypot(at.x - tail.x, at.y - tail.y) < 12) {
      startAnchorDrag(relId, "to");
      return;
    }

    // short / straight / L-bend paths have no interior segment to slide, so
    // inject a smooth S-bend through the grab point (perpendicular to the
    // dominant axis) and slide that single middle segment instead.
    if (pts.length <= 3) {
      const A = pts[0];
      const B = pts[pts.length - 1];
      const dominantH = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y);
      if (dominantH) {
        const y0 = Math.round(at.y);
        const basePts: Pt[] = [A, { x: A.x, y: y0 }, { x: B.x, y: y0 }, B];
        patchRelation(relId, { waypoints: polylineInterior(basePts) });
        setInteract({
          kind: "line",
          relId,
          basePts,
          segIndex: 1,
          axis: "h",
          segBase: y0,
          sx: at.x,
          sy: at.y,
        });
      } else {
        const x0 = Math.round(at.x);
        const basePts: Pt[] = [A, { x: x0, y: A.y }, { x: x0, y: B.y }, B];
        patchRelation(relId, { waypoints: polylineInterior(basePts) });
        setInteract({
          kind: "line",
          relId,
          basePts,
          segIndex: 1,
          axis: "v",
          segBase: x0,
          sx: at.x,
          sy: at.y,
        });
      }
      return;
    }

    // orthogonal polyline: slide the closest interior segment perpendicular to
    // itself, keeping the rest of the shape intact.
    let si = closestSegment(pts, at);
    si = Math.max(1, Math.min(si, pts.length - 3));
    const horizontal = pts[si].y === pts[si + 1].y;
    const axis = horizontal ? "h" : "v";
    const segBase = horizontal ? pts[si].y : pts[si].x;
    setInteract({
      kind: "line",
      relId,
      basePts: pts,
      segIndex: si,
      axis,
      segBase,
      sx: at.x,
      sy: at.y,
    });
  };

  const startLineDrag = (relId: string, clientX: number, clientY: number) => {
    const { x, y } = toContent(clientX, clientY);
    startGrabDrag(relId, { x, y });
  };

  const handleElementMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!isEditable) {
      setSelected({ kind: "element", id });
      return;
    }
    if (connectMode) {
      if (!connectSource) {
        setConnectSource(id);
      } else if (connectSource === id) {
        setConnectSource(null);
      } else {
        addRelation(connectSource, id);
      }
      return;
    }
    const el = findElement(model, id);
    if (!el) return;
    setSelected({ kind: "element", id });
    const { x, y } = toContent(e.clientX, e.clientY);
    setDrag({
      id,
      moved: false,
      startX: x,
      startY: y,
      elStartX: el.x,
      elStartY: el.y,
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (!isEditable) return;
    setSelected(null);
    if (connectMode) {
      setConnectSource(null);
      return;
    }
    setPan({
      startClientX: e.clientX,
      startClientY: e.clientY,
      startViewX: view.x,
      startViewY: view.y,
      moved: false,
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const scale = Math.max(0.2, Math.min(2.5, view.scale * factor));
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const wx = (mx - v.x) / v.scale;
      const wy = (my - v.y) / v.scale;
      return { x: mx - wx * scale, y: my - wy * scale, scale };
    });
  };

  const fitView = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = Math.max(bounds.maxX - bounds.minX + SCOPE_PAD * 2, 200);
    const h = Math.max(bounds.maxY - bounds.minY + SCOPE_PAD * 2, 150);
    const scale = Math.max(
      0.2,
      Math.min(1.2, Math.min(rect.width / w, rect.height / h)),
    );
    setView({
      x:
        rect.width / 2 -
        (bounds.minX + (bounds.maxX - bounds.minX) / 2) * scale,
      y:
        rect.height / 2 -
        (bounds.minY + (bounds.maxY - bounds.minY) / 2) * scale,
      scale,
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("text/plain") as C4ElementKind;
    if (!kind || !isEditable) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const x = (offsetX - view.x) / view.scale - 110;
    const y = (offsetY - view.y) / view.scale - 40;
    addElement(kind, { x, y });
  };

  const selectedElement =
    selected?.kind === "element" ? findElement(model, selected.id) : undefined;
  const selectedRelation =
    selected?.kind === "relation" ? findRelation(model, selected.id) : undefined;
  const selectedRelationPts = useMemo<Pt[] | null>(
    () => routedPointsFor(currentScope.relations, scopeElements, selected?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, selected?.id],
  );

  const requestClose = () => {
    if (!dirty) {
      onClose();
      return;
    }
    modals.openConfirmModal({
      title: t("Unsaved changes"),
      children: (
        <Text size="sm">
          {t("You have unsaved changes that will be lost.")}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Discard"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: onClose,
    });
  };

  const breadcrumbs: { label: string; path: DrillPath }[] = [
    { label: "Context", path: "context" },
    { label: model.name || "System", path: "containerScope" },
  ];
  if (drill !== "context" && drill !== "containerScope") {
    const container = model.containerScope.elements.find((c) => c.id === drill);
    breadcrumbs.push({ label: container?.name || "Container", path: drill });
  }
  const currentBreadcrumbIndex = breadcrumbs.findIndex((b) => b.path === drill);

  return (
    <Modal.Root
      opened={opened}
      onClose={requestClose}
      fullScreen
      closeOnEscape={false}
      aria-label="C4 model designer"
    >
      <Modal.Overlay />
      <Modal.Content style={{ overflow: "hidden" }}>
        <Modal.Body pos="relative" p={0} style={{ height: "100vh" }}>
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "0 16px",
                height: 52,
                borderBottom: "1px solid var(--mantine-color-default-border)",
                flexShrink: 0,
              }}
            >
              <Badge color="blue" variant="light">
                C4 Model
              </Badge>
              {breadcrumbs.map((b, i) => (
                <span key={b.path} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {i > 0 && (
                    <span style={{ color: "var(--mantine-color-dimmed)" }}>/</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDrill(b.path);
                      setSelected(null);
                      setConnectMode(false);
                      setConnectSource(null);
                    }}
                    style={{
                      background:
                        i === currentBreadcrumbIndex
                          ? "var(--mantine-color-gray-light)"
                          : "transparent",
                      border: "none",
                      borderRadius: 6,
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: i === currentBreadcrumbIndex ? 600 : 400,
                      color: "var(--mantine-color-text)",
                    }}
                  >
                    {b.label}
                  </button>
                </span>
              ))}
              <div style={{ flex: 1 }} />
              <Tooltip
                label={connectMode ? "Stop connecting elements" : "Connect elements"}
              >
                <ActionIcon
                  variant={connectMode ? "filled" : "subtle"}
                  color={connectMode ? "green" : "gray"}
                  onClick={() => {
                    if (connectMode) {
                      setConnectMode(false);
                      setConnectSource(null);
                    } else {
                      setConnectMode(true);
                      setSelected(null);
                    }
                  }}
                >
                  {connectMode ? <IconLinkOff size={18} /> : <IconLink size={18} />}
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Fit to screen">
                <ActionIcon variant="subtle" color="gray" onClick={fitView}>
                  <IconArrowsMaximize size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Zoom out">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() =>
                    setView((v) => ({ ...v, scale: Math.max(0.2, v.scale / 1.12) }))
                  }
                >
                  <IconZoomOut size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Zoom in">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() =>
                    setView((v) => ({ ...v, scale: Math.min(2.5, v.scale * 1.12) }))
                  }
                >
                  <IconZoomIn size={18} />
                </ActionIcon>
              </Tooltip>
              <Divider orientation="vertical" />
              {isEditable && (
                <>
                  <Button onClick={requestClose} variant="default" size="xs">
                    Cancel
                  </Button>
                  <Button
                    onClick={() =>
                      onSave({
                        data: JSON.stringify(model),
                        name: model.name,
                        description: model.description,
                      })
                    }
                    size="xs"
                    leftSection={<IconDeviceFloppy size={15} />}
                  >
                    Save
                  </Button>
                </>
              )}
            </div>

            {/* Body */}
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              {/* Left: palette */}
              <div
                style={{
                  width: 210,
                  flexShrink: 0,
                  borderRight: "1px solid var(--mantine-color-default-border)",
                  padding: 12,
                  overflowY: "auto",
                }}
              >
                <InputLabel fw={600} mb={8} size="xs">
                  Level {currentLevel === "context" ? "1" : currentLevel === "container" ? "2" : "3"}{" "}
                  · {levelLabel(currentLevel)}
                </InputLabel>
                {isEditable ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {PALETTE[currentLevel].map((item) => (
                      <PaletteCard
                        key={item.kind}
                        item={item}
                        onAdd={() => addElement(item.kind)}
                      />
                    ))}
                    <Text span size="xs" c="dimmed" mt={8}>
                      Drag palette items onto the canvas, or click to add.
                    </Text>
                    <Text span size="xs" c="dimmed">
                      {currentLevel === "context"
                        ? 'Double-click the software system to drill down to containers.'
                        : currentLevel === "container"
                          ? "Double-click a container to drill down to its components."
                          : "Use the breadcrumb to go back up a level."}
                    </Text>
                    {scopeElements.length === 0 && (
                      <Badge color="orange" variant="light" mt={4}>
                        This level is empty
                      </Badge>
                    )}
                  </div>
                ) : (
                  <Text size="xs" c="dimmed">
                    Read-only. {scopeElements.length} element
                    {scopeElements.length === 1 ? "" : "s"}.
                  </Text>
                )}
              </div>

              {/* Center: canvas */}
              <div
                style={{
                  flex: 1,
                  position: "relative",
                  overflow: "hidden",
                  background: "var(--mantine-color-body)",
                }}
                onWheel={handleWheel}
              >
                <svg
                  ref={svgRef}
                  width="100%"
                  height="100%"
                  style={{
                    display: "block",
                    cursor: connectMode
                      ? "crosshair"
                      : drag?.moved || pan?.moved
                        ? "grabbing"
                        : "default",
                  }}
                  onMouseDown={handleCanvasMouseDown}
                  onDragOver={(e) => isEditable && e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
                    {boundaryLabel && scopeElements.length > 0 && (
                      <BoundaryBox label={boundaryLabel} elements={scopeElements} />
                    )}
                    <rect
                      x={bounds.minX - 200}
                      y={bounds.minY - 140}
                      width={bounds.maxX - bounds.minX + 400}
                      height={bounds.maxY - bounds.minY + 280}
                      fill="transparent"
                      style={{ pointerEvents: "all" }}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <C4SvgRelations
                      relations={currentScope.relations}
                      elements={scopeElements}
                      interaction={{
                        editable: isEditable,
                        selectedId:
                          selected?.kind === "relation" ? selected.id : null,
                        onSelect: (id) => {
                          setConnectSource(null);
                          setSelected({ kind: "relation", id });
                        },
                        onLineDown:
                          isEditable && !connectMode
                            ? (id, cx, cy) => startLineDrag(id, cx, cy)
                            : undefined,
                        onLabelDown:
                          isEditable && !connectMode
                            ? (id, cx, cy) => startLabelDrag(id, cx, cy)
                            : undefined,
                      }}
                    />
                    {scopeElements.map((el) => (
                      <g
                        key={el.id}
                        onMouseDown={(e) => handleElementMouseDown(e, el.id)}
                        onDoubleClick={() => drillInto(el.id)}
                        style={{
                          cursor: isDrillable(el.kind) ? "pointer" : connectMode ? "pointer" : "move",
                        }}
                      >
                        <C4SvgElement
                          el={el}
                          selected={
                            selected?.kind === "element" && selected.id === el.id
                          }
                          connectSource={connectSource === el.id}
                        />
                      </g>
                    ))}
                    {selectedRelation &&
                      selectedRelationPts &&
                      isEditable &&
                      !connectMode && (
                        <C4SvgRelationHandles
                          relation={selectedRelation}
                          pts={selectedRelationPts}
                          editable={isEditable}
                          onAnchorDown={(end) =>
                            startAnchorDrag(selectedRelation.id, end)
                          }
                          onGrab={(at) => startGrabDrag(selectedRelation.id, at)}
                        />
                      )}
                  </g>
                </svg>
              </div>

              {/* Right: properties */}
              <div
                style={{
                  width: 260,
                  flexShrink: 0,
                  borderLeft: "1px solid var(--mantine-color-default-border)",
                  padding: 14,
                  overflowY: "auto",
                }}
              >
                {selectedElement ? (
                  <ElementProperties
                    el={selectedElement}
                    onPatch={(patch) => patchElement(selectedElement.id, patch)}
                    onDelete={() => deleteElement(selectedElement.id)}
                    isEditable={isEditable}
                  />
                ) : selectedRelation ? (
                  <RelationProperties
                    rel={selectedRelation}
                    fromName={
                      findElement(model, selectedRelation.fromId)?.name || ""
                    }
                    toName={
                      findElement(model, selectedRelation.toId)?.name || ""
                    }
                    onPatch={(patch) => patchRelation(selectedRelation.id, patch)}
                    onDelete={() => deleteRelation(selectedRelation.id)}
                    isEditable={isEditable}
                  />
                ) : (
                  <DiagramSettings
                    name={model.name}
                    description={model.description}
                    onPatch={(patch) => {
                      const next = clone(model);
                      Object.assign(next, patch);
                      commitModel(next);
                    }}
                    isEditable={isEditable}
                  />
                )}
              </div>
            </div>
          </div>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

function levelLabel(level: C4Level): string {
  return level === "context"
    ? "Context"
    : level === "container"
      ? "Containers"
      : "Components";
}

function PaletteCard({
  item,
  onAdd,
}: {
  item: PaletteItem;
  onAdd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.kind);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onAdd}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 8,
        cursor: "grab",
        background: item.external
          ? "#fafafa"
          : "var(--mantine-color-body)",
        userSelect: "none",
      }}
    >
      <svg width={26} height={26} viewBox="0 0 26 26">
        {item.kind === "person" || item.kind === "externalPerson" ? (
          <>
            <circle cx={13} cy={8} r={4} fill={item.color} />
            <path d="M5 22 Q13 14 21 22 Z" fill={item.color} />
          </>
        ) : (
          <rect
            x={2}
            y={5}
            width={22}
            height={16}
            rx={item.kind.includes("container") ? 4 : 0}
            fill={item.color}
          />
        )}
      </svg>
      <Text size="xs" fw={500}>
        {item.label}
      </Text>
    </div>
  );
}

function ElementProperties({
  el,
  onPatch,
  onDelete,
  isEditable,
}: {
  el: C4Elem;
  onPatch: (patch: Partial<C4Elem>) => void;
  onDelete: () => void;
  isEditable: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InputLabel fw={600} size="xs">
        Element · {kindLabel(el.kind)}
      </InputLabel>
      {isEditable ? (
        <>
          <TextInput
            label="Name"
            size="xs"
            value={el.name}
            onChange={(e) => onPatch({ name: e.currentTarget.value })}
          />
          <TextInput
            label="Technology"
            size="xs"
            value={el.technology || ""}
            placeholder="e.g. Node.js, MySQL"
            onChange={(e) => onPatch({ technology: e.currentTarget.value })}
          />
          <Textarea
            label="Description"
            size="xs"
            autosize
            minRows={2}
            maxRows={5}
            value={el.description || ""}
            onChange={(e) => onPatch({ description: e.currentTarget.value })}
          />
          <Button
            size="xs"
            color="red"
            variant="light"
            leftSection={<IconTrash size={14} />}
            onClick={onDelete}
          >
            Delete element
          </Button>
        </>
      ) : (
        <>
          {el.technology && <Text size="xs">{el.technology}</Text>}
          {el.description && (
            <Text size="xs" c="dimmed">
              {el.description}
            </Text>
          )}
        </>
      )}
    </div>
  );
}

function RelationProperties({
  rel,
  fromName,
  toName,
  onPatch,
  onDelete,
  isEditable,
}: {
  rel: C4Relation;
  fromName: string;
  toName: string;
  onPatch: (patch: Partial<C4Relation>) => void;
  onDelete: () => void;
  isEditable: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InputLabel fw={600} size="xs">
        Relationship
      </InputLabel>
      <Text size="xs" c="dimmed">
        {fromName} → {toName}
      </Text>
      {isEditable ? (
        <>
          <TextInput
            label="Label"
            size="xs"
            value={rel.label || ""}
            placeholder="e.g. uses"
            onChange={(e) => onPatch({ label: e.currentTarget.value })}
          />
          <TextInput
            label="Technology"
            size="xs"
            value={rel.technology || ""}
            onChange={(e) => onPatch({ technology: e.currentTarget.value })}
          />
          <div>
            <InputLabel fw={600} size="xs" mb={6}>
              Arrow
            </InputLabel>
            <SegmentedControl
              size="xs"
              fullWidth
              data={[
                { label: "None", value: "none" },
                { label: "End", value: "end" },
                { label: "Both", value: "both" },
              ]}
              value={rel.arrow ?? "end"}
              onChange={(value) => onPatch({ arrow: value as C4ArrowType })}
            />
          </div>
          <Button
            size="xs"
            color="red"
            variant="light"
            leftSection={<IconTrash size={14} />}
            onClick={onDelete}
          >
            Delete relationship
          </Button>
        </>
      ) : (
        rel.label && <Text size="xs">{rel.label}</Text>
      )}
    </div>
  );
}

function DiagramSettings({
  name,
  description,
  onPatch,
  isEditable,
}: {
  name: string;
  description: string;
  onPatch: (patch: Partial<C4ModelData>) => void;
  isEditable: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InputLabel fw={600} size="xs">
        Diagram settings
      </InputLabel>
      {isEditable ? (
        <>
          <TextInput
            label="Software system name"
            size="xs"
            value={name}
            onChange={(e) => onPatch({ name: e.currentTarget.value })}
          />
          <Textarea
            label="System description"
            size="xs"
            autosize
            minRows={2}
            maxRows={4}
            value={description}
            onChange={(e) => onPatch({ description: e.currentTarget.value })}
          />
        </>
      ) : (
        <>
          <Text size="sm" fw={600}>
            {name}
          </Text>
          {description && (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          )}
        </>
      )}
    </div>
  );
}