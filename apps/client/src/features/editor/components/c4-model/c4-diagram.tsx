import { useEffect, useId, useRef, useState } from "react";
import type {
  C4Anchor,
  C4Elem,
  C4Point,
  C4Relation,
} from "@docmost/editor-ext";
import { elementStyle, isPerson, wrapText } from "./c4-model-utils";

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface Pt {
  x: number;
  y: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function relationAnchor(
  from: C4Elem,
  to: C4Elem,
): { x1: number; y1: number; x2: number; y2: number } {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  const vertical = Math.abs(dy) > Math.abs(dx);
  if (vertical) {
    const fromBottom = from.y + from.h < tc.y;
    const x1 = fc.x;
    const y1 = fromBottom ? from.y + from.h : from.y;
    const x2 = tc.x;
    const y2 = fromBottom ? to.y : to.y + to.h;
    return { x1, y1, x2, y2 };
  }
  const fromRight = fc.x < tc.x;
  const x1 = fromRight ? from.x + from.w : from.x;
  const y1 = fc.y;
  const x2 = fromRight ? to.x : to.x + to.w;
  const y2 = tc.y;
  return { x1, y1, x2, y2 };
}

/**
 * Converts a normalized anchor (0..1 inside the element box) into a point
 * on the element's boundary. The ray from the element center through the
 * anchor is intersected with the rectangle edge, so any point on any side
 * (or corner) can be targeted.
 */
export function anchorPoint(el: C4Elem, anchor?: C4Anchor): Pt {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  if (!anchor) return { x: cx, y: cy };
  const ax = el.x + clamp01(anchor.x) * el.w;
  const ay = el.y + clamp01(anchor.y) * el.h;
  const dx = ax - cx;
  const dy = ay - cy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { x: cx, y: cy };
  const tx = dx !== 0 ? el.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? el.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

type Side = "top" | "bottom" | "left" | "right";

function boundarySide(el: C4Elem, pt: Pt): Side {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const dx = (pt.x - cx) / (el.w / 2);
  const dy = (pt.y - cy) / (el.h / 2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "bottom" : "top";
  return dx >= 0 ? "right" : "left";
}

function sideAnchor(el: C4Elem, side: Side): Pt {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  switch (side) {
    case "top":
      return { x: cx, y: el.y };
    case "bottom":
      return { x: cx, y: el.y + el.h };
    case "left":
      return { x: el.x, y: cy };
    case "right":
      return { x: el.x + el.w, y: cy };
  }
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rectFor(el: C4Elem, margin = 0): Rect {
  return {
    left: el.x - margin,
    top: el.y - margin,
    right: el.x + el.w + margin,
    bottom: el.y + el.h + margin,
  };
}

function clampT(
  a: number,
  b: number,
  lo: number,
  hi: number,
): [number, number] | null {
  const d = b - a;
  if (Math.abs(d) < 1e-9) {
    return a >= lo && a <= hi ? [0, 1] : null;
  }
  let t1 = (lo - a) / d;
  let t2 = (hi - a) / d;
  if (t1 > t2) [t1, t2] = [t2, t1];
  return [t1, t2];
}

function segmentIntersectsRect(p1: Pt, p2: Pt, rect: Rect): boolean {
  const tx = clampT(p1.x, p2.x, rect.left, rect.right);
  const ty = clampT(p1.y, p2.y, rect.top, rect.bottom);
  if (!tx || !ty) return false;
  const lo = Math.max(tx[0], ty[0]);
  const hi = Math.min(tx[1], ty[1]);
  return hi >= lo && hi >= 0 && lo <= 1;
}

function countHits(pts: Pt[], blockers: Rect[]): number {
  let bad = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (const rect of blockers) {
      if (segmentIntersectsRect(pts[i], pts[i + 1], rect)) bad++;
    }
  }
  return bad;
}

function collapsePoints(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

function pathLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
  }
  return len;
}

function laneSamples(a: number, b: number, lo: number, hi: number, limit = 7): number[] {
  const raw = [
    a,
    b,
    (a + b) / 2,
    (2 * a + b) / 3,
    (a + 2 * b) / 3,
    Math.min(a, b) - 120,
    Math.max(a, b) + 120,
  ];
  const set = new Set<number>([]);
  for (const v of raw) {
    if (v >= lo && v <= hi) set.add(v);
  }
  const uniq = [...set].sort(
    (m, n) => Math.abs(m - (a + b) / 2) - Math.abs(n - (a + b) / 2),
  );
  return limit ? uniq.slice(0, limit) : uniq;
}

function pointOnSegmentClosest(p1: Pt, p2: Pt, p: Pt): { pt: Pt; t: number } {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp01(((p.x - p1.x) * dx + (p.y - p1.y) * dy) / len2);
  return { pt: { x: p1.x + dx * t, y: p1.y + dy * t }, t };
}

/** Finds the closest point on an orthogonal polyline to a given point,
 * returning the normalized parameter (0..1) along the whole path. */
export function polylineClosest(pts: Pt[], p: Pt): { pt: Pt; t: number } {
  let best: { pt: Pt; t: number } | null = null;
  let bestDist = Infinity;
  let acc = 0;
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return { pt: pts[0], t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const res = pointOnSegmentClosest(pts[i], pts[i + 1], p);
    const dist = Math.hypot(res.pt.x - p.x, res.pt.y - p.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { pt: res.pt, t: (acc + res.t * segLens[i]) / total };
    }
    acc += segLens[i];
  }
  return best || { pt: pts[0], t: 0 };
}

/** Returns the index of the polyline segment closest to the given point. */
export function closestSegment(pts: Pt[], p: Pt): number {
  if (pts.length < 2) return 0;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const { pt } = pointOnSegmentClosest(pts[i], pts[i + 1], p);
    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI;
}

/** Returns the interior bend points (duplicates removed) of a polyline. */
export function polylineInterior(pts: Pt[]): Pt[] {
  return pts.length >= 3 ? collapsePoints(pts.slice(1, -1)) : [];
}

/** Returns the point at a normalized distance (0..1) along an orthogonal polyline. */
export function pointAlong(pts: Pt[], t: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  const total = pathLength(pts);
  if (total === 0) return pts[0];
  let target = clamp01(t) * total;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
    if (target > len) {
      target -= len;
      continue;
    }
    const k = len === 0 ? 0 : target / len;
    return {
      x: pts[i].x + (pts[i + 1].x - pts[i].x) * k,
      y: pts[i].y + (pts[i + 1].y - pts[i].y) * k,
    };
  }
  return pts[pts.length - 1];
}

function segmentIndexAt(pts: Pt[], t: number): number {
  const total = pathLength(pts);
  let target = clamp01(t) * total;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
    if (target <= len || i === pts.length - 2) return i;
    target -= len;
  }
  return Math.max(0, pts.length - 2);
}

function segmentHorizontal(pts: Pt[], i: number): boolean {
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
}

/**
 * Shifts the middle of an orthogonal path perpendicular to its main direction
 * by `offset`, producing a small "shelf" so parallel connectors fan out and
 * do not stack on top of each other.
 */
function offsetPath(pts: Pt[], offset: number): Pt[] {
  if (Math.abs(offset) < 0.5) return pts;
  if (pts.length === 2) {
    const p0 = pts[0];
    const p1 = pts[1];
    const horizontal = Math.abs(p1.x - p0.x) >= Math.abs(p1.y - p0.y);
    const mid = {
      x: (p0.x + p1.x) / 2 + (horizontal ? 0 : offset),
      y: (p0.y + p1.y) / 2 + (horizontal ? offset : 0),
    };
    return collapsePoints([p0, mid, p1]);
  }
  let bestIdx = -1;
  let bestLen = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y);
    if (len > bestLen) {
      bestLen = len;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return pts;
  const s = pts[bestIdx];
  const e = pts[bestIdx + 1];
  const horizontal = Math.abs(e.y - s.y) < 1e-6;
  const dx = horizontal ? 0 : offset;
  const dy = horizontal ? offset : 0;
  return pts.map((p, i) =>
    i === bestIdx || i === bestIdx + 1
      ? { x: p.x + dx, y: p.y + dy }
      : p,
  );
}

/** Picks the shorter, obstacle-free orthogonal connection between two points. */
function bestOrthoLeg(p: Pt, q: Pt, blockers: Rect[]): Pt[] {
  const aligned =
    Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
  if (aligned) return [p, q];
  const hv: Pt[] = [p, { x: q.x, y: p.y }, q];
  const vh: Pt[] = [p, { x: p.x, y: q.y }, q];
  const h1 = countHits(hv, blockers);
  const h2 = countHits(vh, blockers);
  const l1 = pathLength(hv);
  const l2 = pathLength(vh);
  return h1 < h2 || (h1 === h2 && l1 <= l2) ? hv : vh;
}

/** Builds an orthogonal polyline through user-dragged waypoints. */
function routeThroughWaypoints(
  start: Pt,
  waypoints: C4Point[],
  end: Pt,
  blockers: Rect[],
): Pt[] {
  const pts: Pt[] = [start];
  let prev = start;
  for (const wp of waypoints) {
    const leg = bestOrthoLeg(prev, wp, blockers);
    for (const p of leg) {
      const last = pts[pts.length - 1];
      if (last.x !== p.x || last.y !== p.y) pts.push(p);
    }
    prev = wp;
  }
  const leg = bestOrthoLeg(prev, end, blockers);
  for (const p of leg) {
    const last = pts[pts.length - 1];
    if (last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  return collapsePoints(pts);
}

interface RouteOptions {
  laneOffset?: number;
}

type RouteRelShape = Pick<C4Relation, "fromAnchor" | "toAnchor" | "waypoints">;

function generateOrthoCandidates(
  a1: Pt,
  a2: Pt,
  s1: Side,
  s2: Side,
  fixed1: boolean,
  fixed2: boolean,
  blockers: Rect[],
  out: { pts: Pt[]; len: number; hits: number }[],
): void {
  const h1 = s1 === "left" || s1 === "right";
  const h2 = s2 === "left" || s2 === "right";

  const xRange: [number, number] = [-Infinity, Infinity];
  const yRange: [number, number] = [-Infinity, Infinity];
  if (h1) {
    if (s1 === "left") xRange[1] = Math.min(xRange[1], a1.x);
    else xRange[0] = Math.max(xRange[0], a1.x);
  } else {
    if (s1 === "top") yRange[1] = Math.min(yRange[1], a1.y);
    else yRange[0] = Math.max(yRange[0], a1.y);
  }
  if (h2) {
    if (s2 === "left") xRange[1] = Math.min(xRange[1], a2.x);
    else xRange[0] = Math.max(xRange[0], a2.x);
  } else {
    if (s2 === "top") yRange[1] = Math.min(yRange[1], a2.y);
    else yRange[0] = Math.max(yRange[0], a2.y);
  }

  const constrainX = (v: number) => Math.max(xRange[0], Math.min(xRange[1], v));
  const constrainY = (v: number) => Math.max(yRange[0], Math.min(yRange[1], v));

  // H-V-H:  [a1, (xl, a1.y), (xl, a2.y), a2]
  const hvhValid = (!fixed1 || h1) && (!fixed2 || h2);
  if (hvhValid) {
    for (const xl of laneSamples(a1.x, a2.x, xRange[0], xRange[1])) {
      const pts = collapsePoints([
        a1,
        { x: xl, y: a1.y },
        { x: constrainX(xl), y: a2.y },
        a2,
      ]);
      out.push({ pts, len: pathLength(pts), hits: countHits(pts, blockers) });
    }
  }

  // V-H-V:  [a1, (a1.x, yl), (a2.x, yl), a2]
  const vhvValid = (!fixed1 || !h1) && (!fixed2 || !h2);
  if (vhvValid) {
    for (const yl of laneSamples(a1.y, a2.y, yRange[0], yRange[1])) {
      const pts = collapsePoints([
        a1,
        { x: a1.x, y: yl },
        { x: a2.x, y: constrainY(yl) },
        a2,
      ]);
      out.push({ pts, len: pathLength(pts), hits: countHits(pts, blockers) });
    }
  }

  // Perpendicular orientations (only when an endpoint is anchored) need a
  // double bend: H-V-H-V: [a1, (lx, a1.y), (lx, ly), (a2.x, ly), a2]
  const hvhvValid = fixed1 || fixed2 ? (!fixed1 || h1) && (!fixed2 || !h2) : false;
  if (hvhvValid) {
    for (const lx of laneSamples(a1.x, a2.x, xRange[0], xRange[1], 4))
      for (const ly of laneSamples(a1.y, a2.y, yRange[0], yRange[1], 4)) {
        const pts = collapsePoints([
          a1,
          { x: constrainX(lx), y: a1.y },
          { x: constrainX(lx), y: constrainY(ly) },
          { x: a2.x, y: constrainY(ly) },
          a2,
        ]);
        out.push({ pts, len: pathLength(pts), hits: countHits(pts, blockers) });
      }
  }

  // V-H-V-H: [a1, (a1.x, ly), (lx, ly), (lx, a2.y), a2]
  const vhvhValid = fixed1 || fixed2 ? (!fixed1 || !h1) && (!fixed2 || h2) : false;
  if (vhvhValid) {
    for (const ly of laneSamples(a1.y, a2.y, yRange[0], yRange[1], 4)) {
      for (const lx of laneSamples(a1.x, a2.x, xRange[0], xRange[1], 4)) {
        const pts = collapsePoints([
          a1,
          { x: a1.x, y: constrainY(ly) },
          { x: constrainX(lx), y: constrainY(ly) },
          { x: constrainX(lx), y: a2.y },
          a2,
        ]);
        out.push({ pts, len: pathLength(pts), hits: countHits(pts, blockers) });
      }
    }
  }
}

/**
 * Routes an orthogonal connector between two elements. Anchors (normalized
 * attachment points) let a connector start/end anywhere on an element's edge,
 * waypoints add user-controlled bends, and laneOffset separates parallel
 * connectors from the same pair so they do not stack.
 */
export function routeRelation(
  from: C4Elem,
  to: C4Elem,
  elements: C4Elem[],
  rel?: RouteRelShape,
  options?: RouteOptions,
): Pt[] {
  const blockers = elements
    .filter((e) => e.id !== from.id && e.id !== to.id)
    .map((e) => rectFor(e, 14));

  const sides: Side[] = ["top", "bottom", "left", "right"];
  const fromAnchor = rel?.fromAnchor;
  const toAnchor = rel?.toAnchor;
  const fromSides = fromAnchor ? [boundarySide(from, anchorPoint(from, fromAnchor))] : sides;
  const toSides = toAnchor ? [boundarySide(to, anchorPoint(to, toAnchor))] : sides;

  const candidates: { pts: Pt[]; len: number; hits: number }[] = [];
  for (const s1 of fromSides) {
    for (const s2 of toSides) {
      const a1 = fromAnchor ? anchorPoint(from, fromAnchor) : sideAnchor(from, s1);
      const a2 = toAnchor ? anchorPoint(to, toAnchor) : sideAnchor(to, s2);
      generateOrthoCandidates(
        a1,
        a2,
        s1,
        s2,
        Boolean(fromAnchor),
        Boolean(toAnchor),
        blockers,
        candidates,
      );
    }
  }

  const a1Direct = fromAnchor ? anchorPoint(from, fromAnchor) : null;
  const a2Direct = toAnchor ? anchorPoint(to, toAnchor) : null;
  let direct: Pt[];
  if (a1Direct && a2Direct) {
    direct = [a1Direct, a2Direct];
  } else {
    const { x1, y1, x2, y2 } = relationAnchor(from, to);
    direct = [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
  }
  candidates.push({ pts: direct, len: pathLength(direct), hits: countHits(direct, blockers) });

  candidates.sort((a, b) => {
    if (a.hits !== b.hits) return a.hits - b.hits;
    return a.len - b.len;
  });

  let pts = candidates[0]?.pts ?? direct;

  const laneOffset = options?.laneOffset ?? 0;
  if (laneOffset && (!rel?.waypoints || rel.waypoints.length === 0)) {
    pts = offsetPath(pts, laneOffset);
  }

  if (rel?.waypoints && rel.waypoints.length > 0) {
    pts = routeThroughWaypoints(pts[0], rel.waypoints, pts[pts.length - 1], blockers);
  }

  return pts;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function contentBounds(
  elements: C4Elem[],
  relations: C4Relation[],
): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const elMap = new Map(elements.map((e) => [e.id, e]));
  if (elements.length === 0 && relations.length === 0) {
    return { minX: 0, minY: 0, maxX: 600, maxY: 400 };
  }
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  for (const rel of relations) {
    const a = elMap.get(rel.fromId);
    const b = elMap.get(rel.toId);
    if (a && b) {
      for (const p of routeRelation(a, b, elements, rel)) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    } else {
      if (a) {
        minX = Math.min(minX, a.x);
        minY = Math.min(minY, a.y);
        maxX = Math.max(maxX, a.x + a.w);
        maxY = Math.max(maxY, a.y + a.h);
      }
      if (b) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
    }
  }
  if (minX === Number.POSITIVE_INFINITY) return { minX: 0, minY: 0, maxX: 600, maxY: 400 };
  return { minX, minY, maxX, maxY };
}

interface ElementProps {
  el: C4Elem;
  selected?: boolean;
  connectSource?: boolean;
  strokeWidth?: number;
}

export function C4SvgElement({ el, selected, connectSource, strokeWidth = 2 }: ElementProps) {
  const style = elementStyle(el.kind);
  const nameLines = wrapText(el.name || "Unnamed", 24).slice(0, 2);
  const techLines = el.technology
    ? wrapText(el.technology, 30).slice(0, 1)
    : [];
  const descLines = el.description
    ? wrapText(el.description, 32).slice(0, 2)
    : [];

  const stroke = selected ? "#ff922b" : connectSource ? "#51cf66" : style.stroke;
  const sw = selected || connectSource ? strokeWidth + 1.5 : strokeWidth;

  if (isPerson(el.kind)) {
    return (
      <g>
        <rect
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          rx={8}
          ry={8}
          fill={style.fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={style.external ? "5,4" : undefined}
        />
        <circle cx={el.x + 28} cy={el.y + 26} r={12} fill="#ffffff" stroke={style.stroke} strokeWidth={1.5} />
        <path
          d={`M ${el.x + 10} ${el.y + 58} Q ${el.x + 28} ${el.y + 36} ${el.x + 46} ${el.y + 58} L ${el.x + 46} ${el.y + 66} L ${el.x + 10} ${el.y + 66} Z`}
          fill="#ffffff"
          stroke={style.stroke}
          strokeWidth={1.5}
        />
        {nameLines.map((line, i) => (
          <text
            key={i}
            x={el.x + 58}
            y={el.y + 34 + i * 16}
            fill={style.text}
            fontSize={nameLines.length === 1 ? 14 : 12}
            fontWeight={700}
            fontFamily={FONT_FAMILY}
            textAnchor="start"
          >
            {line}
          </text>
        ))}
        {techLines.map((line, i) => (
          <text
            key={i}
            x={el.x + 58}
            y={el.y + 38 + nameLines.length * 16 + i * 12}
            fill={style.text}
            fontSize={10}
            fontFamily={FONT_FAMILY}
            textAnchor="start"
            opacity={0.85}
          >
            {line}
          </text>
        ))}
        {descLines.map((line, i) => (
          <text
            key={i}
            x={el.x + 58}
            y={el.y + 40 + nameLines.length * 16 + techLines.length * 12 + 4 + i * 12}
            fill={style.text}
            fontSize={9}
            fontFamily={FONT_FAMILY}
            textAnchor="start"
            opacity={0.75}
          >
            {line}
          </text>
        ))}
      </g>
    );
  }

  const rounded = el.kind === "container" || el.kind === "externalContainer";
  const corner = rounded ? 8 : 0;
  const textCenter = el.x + el.w / 2;
  const nameCount = nameLines.length >= 1 ? Math.max(nameLines.length, 1) : 1;
  const nameBlockH = nameCount * 16;
  const techStartY = el.y + 32 + nameBlockH;
  const descStartY = techStartY + techLines.length * 12 + 6;

  return (
    <g>
      <rect
        x={el.x}
        y={el.y}
        width={el.w}
        height={el.h}
        rx={corner}
        ry={corner}
        fill={style.fill}
        stroke={stroke}
        strokeWidth={sw}
        strokeDasharray={style.external ? "5,4" : undefined}
      />
      {nameLines.map((line, i) => (
        <text
          key={`n${i}`}
          x={textCenter}
          y={el.y + 26 + i * 16}
          fill={style.text}
          fontSize={nameLines.length === 1 ? 14 : 12}
          fontWeight={700}
          textAnchor="middle"
          fontFamily={FONT_FAMILY}
        >
          {line}
        </text>
      ))}
      {techLines.map((line, i) => (
        <text
          key={`t${i}`}
          x={textCenter}
          y={techStartY + i * 12}
          fill={style.text}
          fontSize={10}
          textAnchor="middle"
          fontFamily={FONT_FAMILY}
          opacity={0.85}
        >
          {line}
        </text>
      ))}
      {descLines.map((line, i) => (
        <text
          key={`d${i}`}
          x={textCenter}
          y={descStartY + i * 12}
          fill={style.text}
          fontSize={9}
          textAnchor="middle"
          fontFamily={FONT_FAMILY}
          opacity={0.75}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

const ARROW_COLOR = "#6b7280";

function splitLabelLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + " " + word).length <= 30) {
      current += " " + word;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length ? out.slice(0, 3) : [text];
}

function C4RelationLabel({
  lines,
  x,
  y,
  selected,
  draggable,
  onDragStart,
}: {
  lines: string[];
  x: number;
  y: number;
  selected: boolean;
  draggable: boolean;
  onDragStart?: (clientX: number, clientY: number) => void;
}) {
  const textRef = useRef<SVGTextElement>(null);
  const [boxW, setBoxW] = useState(44);
  const [boxH, setBoxH] = useState(22);
  const lineH = 13;

  const textKey = lines.join("|");

  useEffect(() => {
    let w = 44;
    let h = 22;
    if (textRef.current) {
      const spans = Array.from(textRef.current.querySelectorAll("tspan"));
      let maxLen = 4;
      for (const span of spans) {
        try {
          maxLen = Math.max(maxLen, span.getComputedTextLength());
        } catch {
          /* ignore */
        }
      }
      w = Math.max(maxLen + 14, 30);
      h = lines.length * lineH + 10;
    }
    setBoxW(w);
    setBoxH(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textKey]);

  return (
    <g
      style={{ cursor: draggable ? "grab" : "pointer" }}
      onMouseDown={(e) => {
        if (!onDragStart) return;
        e.stopPropagation();
        onDragStart(e.clientX, e.clientY);
      }}
    >
      <rect
        x={x - boxW / 2}
        y={y - boxH / 2}
        width={boxW}
        height={boxH}
        rx={4}
        fill="rgba(255,255,255,0.94)"
        stroke={selected ? "#ff922b" : "#d1d5db"}
        strokeWidth={selected ? 1.4 : 1}
      />
      <text
        ref={textRef}
        x={x}
        y={y}
        fontSize={10}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#374151"
        fontFamily={FONT_FAMILY}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={x} y={y + (i - (lines.length - 1) / 2) * lineH}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export interface RelationInteraction {
  editable: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onLineDown?: (relId: string, clientX: number, clientY: number) => void;
  onLabelDown?: (relId: string, clientX: number, clientY: number) => void;
}

export function C4SvgRelations({
  relations,
  elements,
  selectedId,
  interaction,
}: {
  relations: C4Relation[];
  elements: C4Elem[];
  selectedId?: string | null;
  interaction?: RelationInteraction;
}) {
  const elMap = new Map(elements.map((e) => [e.id, e]));
  const markerId = `c4-arrow-${useId().replace(/[:-]/g, "")}`;

  const lanes = computeLanes(relations);
  const draggableLines = Boolean(interaction?.editable && interaction.onLineDown);

  return (
    <g>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_COLOR} />
        </marker>
      </defs>
      {relations.map((rel) => {
        const from = elMap.get(rel.fromId);
        const to = elMap.get(rel.toId);
        if (!from || !to) return null;
        const arrow = rel.arrow ?? "end";
        const marker = `url(#${markerId})`;
        const markerStart =
          arrow === "start" || arrow === "both" ? marker : undefined;
        const markerEnd =
          arrow === "end" || arrow === "both" ? marker : undefined;
        const pts = routeRelation(from, to, elements, rel, {
          laneOffset: lanes.get(rel.id) ?? 0,
        });
        const points = pts.map((p) => `${p.x},${p.y}`).join(" ");
        const selected = selectedId === rel.id;
        const stroke = selected ? "#ff922b" : ARROW_COLOR;
        const sw = selected ? 2.6 : 1.8;

        const hasLabel = Boolean(rel.label || rel.technology);
        const labelLines = hasLabel
          ? splitLabelLines([rel.label, rel.technology].filter(Boolean).join(" / "))
          : [];
        const t = typeof rel.labelPos === "number" ? rel.labelPos : 0.5;
        const labelPt = pointAlong(pts, t);
        const seg = segmentIndexAt(pts, t);
        const labelHorizontal = segmentHorizontal(pts, seg);
        const labelPad = (labelLines.length - 1) * 7;
        const labelX = labelHorizontal
          ? labelPt.x
          : labelPt.x + 20 + labelPad;
        const labelY = labelHorizontal
          ? labelPt.y - 17 - labelPad
          : labelPt.y;

        return (
          <g key={rel.id}>
            <polyline
              points={points}
              fill="none"
              stroke={stroke}
              strokeWidth={sw}
              strokeLinejoin="round"
              markerStart={markerStart}
              markerEnd={markerEnd}
            />
            {interaction?.onSelect || draggableLines ? (
              <polyline
                points={points}
                fill="none"
                stroke="rgba(0,0,0,0.001)"
                strokeWidth={16}
                strokeLinejoin="round"
                style={{ cursor: draggableLines ? "move" : "pointer" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (draggableLines && interaction?.onLineDown) {
                    interaction.onLineDown(rel.id, e.clientX, e.clientY);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  interaction?.onSelect?.(rel.id);
                }}
              />
            ) : null}
            {hasLabel && (
              <C4RelationLabel
                lines={labelLines}
                x={labelX}
                y={labelY}
                selected={selected}
                draggable={Boolean(interaction?.editable && interaction.onLabelDown)}
                onDragStart={
                  interaction?.onLabelDown
                    ? (cx, cy) => interaction?.onLabelDown?.(rel.id, cx, cy)
                    : undefined
                }
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Assigns each relation connecting the same pair of elements a small
 * perpendicular lane offset so parallel arrows spread out instead of stacking.
 */
function computeLanes(relations: C4Relation[]): Map<string, number> {
  const groups = new Map<string, C4Relation[]>();
  for (const rel of relations) {
    const key = [rel.fromId, rel.toId].sort().join("::");
    const list = groups.get(key) ?? [];
    list.push(rel);
    groups.set(key, list);
  }
  const lanes = new Map<string, number>();
  const SPACING = 22;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.forEach((rel, i) => {
      if (rel.waypoints && rel.waypoints.length > 0) return;
      lanes.set(rel.id, (i - (list.length - 1) / 2) * SPACING);
    });
  }
  return lanes;
}

/** Routes a single relation exactly as it is rendered (incl. lane offsets). */
export function routedPointsFor(
  relations: C4Relation[],
  elements: C4Elem[],
  relId: string | undefined | null,
): Pt[] | null {
  const rel = relations.find((r) => r.id === relId);
  const from = elements.find((e) => e.id === rel?.fromId);
  const to = elements.find((e) => e.id === rel?.toId);
  if (!rel || !from || !to) return null;
  const lanes = computeLanes(relations);
  return routeRelation(from, to, elements, rel, {
    laneOffset: lanes.get(rel.id) ?? 0,
  });
}

export function C4SvgRelationHandles({
  relation,
  pts,
  editable,
  onAnchorDown,
  onGrab,
}: {
  relation: C4Relation;
  pts: Pt[];
  editable: boolean;
  onAnchorDown: (end: "from" | "to") => void;
  onGrab: (at: Pt) => void;
}) {
  if (!editable || !relation || pts.length < 2) return null;
  const a1 = pts[0];
  const a2 = pts[pts.length - 1];
  const mid = pointAlong(pts, 0.5);
  return (
    <g>
      <circle
        cx={a1.x}
        cy={a1.y}
        r={7}
        fill="#ffffff"
        stroke="#ff922b"
        strokeWidth={1.8}
        style={{ cursor: "grab" }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onAnchorDown("from");
        }}
      />
      <circle
        cx={a2.x}
        cy={a2.y}
        r={7}
        fill="#ffffff"
        stroke="#ff922b"
        strokeWidth={1.8}
        style={{ cursor: "grab" }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onAnchorDown("to");
        }}
      />
      {relation.waypoints?.map((wp) => (
        <circle
          key={`${wp.x}-${wp.y}`}
          cx={wp.x}
          cy={wp.y}
          r={6}
          fill="#ffffff"
          stroke="#9097a6"
          strokeWidth={1.6}
          style={{ cursor: "grab" }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onGrab(wp);
          }}
        />
      ))}
      <circle
        cx={mid.x}
        cy={mid.y}
        r={5}
        fill="#fff4e6"
        stroke="#ff922b"
        strokeWidth={1.4}
        strokeDasharray="2 2"
        style={{ cursor: "grab" }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onGrab(mid);
        }}
      />
    </g>
  );
}

interface BoundaryProps {
  label: string;
  elements: C4Elem[];
  padding?: number;
}

export function BoundaryBox({ label, elements, padding = 40 }: BoundaryProps) {
  const { minX, minY, maxX, maxY } = contentBounds(elements, []);
  const x = minX - padding;
  const y = minY - padding;
  const w = maxX - minX + padding * 2;
  const h = maxY - minY + padding * 2;
  const style = { stroke: "#94a3b8", fill: "rgba(241, 245, 249, 0.55)" };
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={1.6}
        strokeDasharray="8,5"
      />
      <g transform={`translate(${x + 12}, ${y + 14})`}>
        <rect x={-8} y={-13} width={label.length * 7 + 46} height={20} rx={10} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1} />
        <text
          x={0}
          y={0}
          fontSize={11}
          fontWeight={700}
          fill="#475569"
          fontFamily={FONT_FAMILY}
        >
          {label}
        </text>
      </g>
    </g>
  );
}