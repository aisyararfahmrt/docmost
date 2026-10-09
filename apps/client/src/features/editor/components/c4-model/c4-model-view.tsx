import { useRef, useState } from "react";
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ActionIcon, Badge, Card, Text, Tooltip } from "@mantine/core";
import { IconEdit } from "@tabler/icons-react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import type { C4Elem, C4Scope } from "@docmost/editor-ext";
import { C4ModelDesigner } from "./c4-model-designer";
import {
  BoundaryBox,
  C4SvgElement,
  C4SvgRelations,
  contentBounds,
} from "./c4-diagram";
import { parseModel } from "./c4-model-utils";

function previewScopeFor(model: ReturnType<typeof parseModel>): {
  scope: C4Scope;
  elements: C4Elem[];
  boundary: string | null;
  label: string;
} | null {
  if (model.context.elements.length > 0 || model.context.relations.length > 0) {
    return {
      scope: model.context,
      elements: model.context.elements as C4Elem[],
      boundary: null,
      label: model.name,
    };
  }
  if (
    model.containerScope.elements.length > 0 ||
    model.containerScope.relations.length > 0
  ) {
    return {
      scope: model.containerScope,
      elements: model.containerScope.elements as C4Elem[],
      boundary: model.name,
      label: model.name,
    };
  }
  return null;
}

export default function C4ModelView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, updateAttributes, editor, selected } = props;
  const [opened, setOpened] = useState(false);
  const data = parseModel(node.attrs.data);
  const preview = previewScopeFor(data);
  const containerRef = useRef<HTMLDivElement>(null);

  const openEditor = () => {
    if (!editor.isEditable) return;
    setOpened(true);
  };

  const previewPad = 24;
  let viewBox = "0 0 400 200";
  if (preview) {
    const b = contentBounds(preview.elements, preview.scope.relations);
    const x = b.minX - previewPad;
    const y = b.minY - previewPad;
    const w = Math.max(b.maxX - b.minX + previewPad * 2, 200);
    const h = Math.max(b.maxY - b.minY + previewPad * 2, 120);
    viewBox = `${x} ${y} ${w} ${h}`;
  }

  const title = data.name || "C4 Model";

  return (
    <NodeViewWrapper data-drag-handle>
      <Card
        radius="md"
        withBorder
        p="xs"
        className={clsx(selected ? "ProseMirror-selectednode" : "")}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "2px 4px 8px 4px",
          }}
        >
          <Badge color="blue" variant="light" size="sm">
            C4 Model
          </Badge>
          <Text size="sm" fw={600} lineClamp={1} style={{ flex: 1 }}>
            {title}
          </Text>
          {!preview && (
            <Text size="xs" c="dimmed">
              {t("Empty diagram")}
            </Text>
          )}
          {editor.isEditable && (
            <Tooltip label={t("Edit C4 model")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={t("Edit C4 model")}
                onClick={openEditor}
              >
                <IconEdit size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </div>

        <div
          ref={containerRef}
          onClick={(e) => {
            if (e.detail === 2) openEditor();
          }}
          style={{
            minHeight: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: editor.isEditable ? (preview ? "pointer" : "default") : "default",
            background: "var(--mantine-color-gray-light-hover)",
            borderRadius: 8,
            overflow: "hidden",
            padding: 8,
          }}
        >
          {preview ? (
            <svg
              width="100%"
              viewBox={viewBox}
              preserveAspectRatio="xMidYMid meet"
              style={{ display: "block", maxHeight: 460 }}
            >
              {preview.boundary && (
                <BoundaryBox label={preview.boundary} elements={preview.elements} />
              )}
              <C4SvgRelations relations={preview.scope.relations} elements={preview.elements} />
              {preview.elements.map((el) => (
                <C4SvgElement key={el.id} el={el} />
              ))}
            </svg>
          ) : (
            <Text size="sm" c="dimmed" ta="center" p="sm">
              {t("This C4 model is empty. Double-click to open the designer.")}
            </Text>
          )}
        </div>

        {editor.isEditable && (
          <Text
            size="xs"
            c="dimmed"
            ta="center"
            mt={6}
            style={{ cursor: "default" }}
          >
            {t("Double-click to edit C4 model")}
          </Text>
        )}
      </Card>

      <C4ModelDesigner
        opened={opened}
        onClose={() => setOpened(false)}
        initialData={node.attrs.data}
        isEditable={editor.isEditable}
        onSave={(payload) => {
          updateAttributes(payload);
          setOpened(false);
        }}
      />
    </NodeViewWrapper>
  );
}