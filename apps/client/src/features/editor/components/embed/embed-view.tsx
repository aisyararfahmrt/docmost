import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import React, {
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import {
  ActionIcon,
  Button,
  Card,
  FocusTrap,
  Group,
  Modal,
  NumberInput,
  Popover,
  Slider,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconArrowsMaximize,
  IconEdit,
  IconRefresh,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import { z } from "zod/v4";
import { useForm } from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import {
  getEmbedProviderById,
  getEmbedUrlAndProvider,
  normalizeFigmaSourceUrl,
  sanitizeUrl,
} from "@docmost/editor-ext";
import { ResizableWrapper } from "../common/resizable-wrapper";
import classes from "./embed-view.module.css";

const DEFAULT_EMBED_WIDTH = 800;
const DEFAULT_EMBED_HEIGHT = 600;
const MIN_MARGIN_X = 0;
const MAX_MARGIN_X = 120;
const MIN_FIT_HEIGHT = 200;
const MAX_FIT_HEIGHT = 1600;
const SIDE_GUTTER = 16;
// Locked-down Figma iframe: no popups => native "Open in Figma" (new tab)
// silently does nothing. Fullscreen/zoom tetap jalan via viewport-controls
// + tombol fullscreen custom kita sendiri.
const FIGMA_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-presentation";
const FIGMA_ALLOW =
  "encrypted-media; clipboard-read; clipboard-write; picture-in-picture; fullscreen";
const GENERIC_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-presentation";

const schema = z.object({
  url: z.url({ message: i18n.t("Please enter a valid url") }).trim(),
});

function normalizeDimension(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeMargin(value: unknown) {
  const margin =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : 0;
  if (!Number.isFinite(margin)) return 0;
  return Math.max(MIN_MARGIN_X, Math.min(MAX_MARGIN_X, Math.round(margin)));
}

function clampHeight(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_EMBED_HEIGHT;
  return Math.max(
    MIN_FIT_HEIGHT,
    Math.min(MAX_FIT_HEIGHT, Math.round(value)),
  );
}

export default function EmbedView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, selected, updateAttributes, editor, deleteNode } = props;
  const {
    src,
    provider,
    width: nodeWidth,
    height: nodeHeight,
    fitToScreen,
    marginX,
    figmaPages,
  } = node.attrs;
  const embedProvider = useMemo(
    () => getEmbedProviderById(provider),
    [provider],
  );
  const isFigma = embedProvider?.id === "figma";
  const providerName = embedProvider?.name || "Embed";
  const isFitToScreen = isFigma && fitToScreen !== false;
  const normalizedWidth = normalizeDimension(nodeWidth, DEFAULT_EMBED_WIDTH);
  const normalizedHeight = normalizeDimension(
    nodeHeight,
    DEFAULT_EMBED_HEIGHT,
  );
  const normalizedMarginX = isFigma ? normalizeMargin(marginX) : 0;
  // Figma URL is locked: once src is set, it can no longer be viewed or
  // edited from the UI. Delete + re-insert to change the source.
  const isFigmaLocked = isFigma && Boolean(src);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const breakoutRef = useRef<HTMLDivElement | null>(null);
  const fitBoxRef = useRef<HTMLDivElement | null>(null);
  const [isHeightResizing, setIsHeightResizing] = useState(false);
  const [figmaFullscreen, setFigmaFullscreen] = useState(false);
  const [figmaNonce, setFigmaNonce] = useState(0);
  const heightDragRef = useRef<{
    startY: number;
    startHeight: number;
    currentHeight: number;
  } | null>(null);

  const embedUrl = useMemo(() => {
    if (src) {
      return getEmbedUrlAndProvider(src).embedUrl;
    }
    return null;
  }, [src]);

  const safeEmbedUrl = embedUrl ? sanitizeUrl(embedUrl) : null;
  const showFigmaPages = figmaPages !== false;
  // Apply the per-node page-selector toggle on top of the base Kit 2 URL.
  const figmaUrl = useMemo(() => {
    if (!isFigma || !safeEmbedUrl) return safeEmbedUrl;
    try {
      const u = new URL(safeEmbedUrl);
      if (u.hostname.includes("figma.com")) {
        u.searchParams.set("page-selector", showFigmaPages ? "true" : "false");
        return u.toString();
      }
    } catch {
      // Keep base URL on parse failure.
    }
    return safeEmbedUrl;
  }, [isFigma, safeEmbedUrl, showFigmaPages]);

  const embedForm = useForm<{ url: string }>({
    initialValues: {
      url: "",
    },
    validate: zod4Resolver(schema),
  });

  const handleResize = useCallback(
    (newWidth: number, newHeight: number) => {
      updateAttributes({ width: newWidth, height: newHeight });
    },
    [updateAttributes],
  );

  // Full-bleed breakout for Figma fit mode.
  // The page editor is a centered 900px Container by default, so a plain
  // width:100% can never be truly "fit to screen". Measure the centered
  // container against <main> and pull the breakout wrapper out with
  // negative margins (same technique as base-embed).
  useEffect(() => {
    if (!isFitToScreen || !embedUrl) return;

    const container = containerRef.current;
    const breakout = breakoutRef.current;
    if (!container || !breakout) return;

    const update = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;

      const main = container.closest("main") as HTMLElement | null;
      const mainRect = main?.getBoundingClientRect();
      const targetLeft = (mainRect?.left ?? 0) + SIDE_GUTTER;
      const targetRight = mainRect
        ? mainRect.right - SIDE_GUTTER
        : window.innerWidth - SIDE_GUTTER;

      const extendLeft = Math.max(0, rect.left - targetLeft);
      const extendRight = Math.max(0, targetRight - rect.right);

      breakout.style.setProperty("--embed-extend-l", `${extendLeft}px`);
      breakout.style.setProperty("--embed-extend-r", `${extendRight}px`);
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(container);
    const main = container.closest("main");
    if (main) ro.observe(main);

    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [isFitToScreen, embedUrl, normalizedMarginX]);

  // Keep the live drag height in sync when the attribute changes externally.
  useEffect(() => {
    if (heightDragRef.current || !fitBoxRef.current) return;
    fitBoxRef.current.style.height = `${normalizedHeight}px`;
  }, [normalizedHeight, isFitToScreen]);

  const startHeightResize = useCallback(
    (e: React.MouseEvent) => {
      if (!editor.isEditable) return;
      e.preventDefault();
      e.stopPropagation();

      heightDragRef.current = {
        startY: e.clientY,
        startHeight: normalizedHeight,
        currentHeight: normalizedHeight,
      };
      setIsHeightResizing(true);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const drag = heightDragRef.current;
        const box = fitBoxRef.current;
        if (!drag || !box) return;
        const next = clampHeight(
          drag.startHeight + (ev.clientY - drag.startY),
        );
        drag.currentHeight = next;
        box.style.height = `${next}px`;
      };

      const onUp = () => {
        const drag = heightDragRef.current;
        heightDragRef.current = null;
        setIsHeightResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (drag) {
          updateAttributes({ height: drag.currentHeight });
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [editor.isEditable, normalizedHeight, updateAttributes],
  );

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  async function onSubmit(data: { url: string }) {
    if (!editor.isEditable) {
      return;
    }

    // Locked Figma embeds never accept URL edits from the UI.
    if (isFigmaLocked) return;

    if (provider) {
      if (!embedProvider || embedProvider.id === "iframe") {
        updateAttributes({ src: sanitizeUrl(data.url) });
        return;
      }
      if (embedProvider.regex.test(data.url)) {
        const cleanUrl =
          embedProvider.id === "figma"
            ? sanitizeUrl(normalizeFigmaSourceUrl(data.url))
            : sanitizeUrl(data.url);
        updateAttributes({ src: cleanUrl });
      } else {
        notifications.show({
          message: t("Invalid {{provider}} embed link", {
            provider: embedProvider.name,
          }),
          position: "top-right",
          color: "red",
        });
      }
    }
  }

  function handleFitToScreenChange(enabled: boolean) {
    if (!isFigma || !editor.isEditable) {
      return;
    }

    updateAttributes({
      fitToScreen: enabled,
      width: enabled ? null : normalizedWidth,
    });
  }

  function handleMarginChange(value: string | number) {
    if (!isFigma || !editor.isEditable) {
      return;
    }

    const nextMargin = normalizeMargin(value);
    updateAttributes({ marginX: nextMargin });
  }

  function handleHeightChange(value: string | number) {
    if (!editor.isEditable) {
      return;
    }

    const rawHeight =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseFloat(value)
          : NaN;

    if (!Number.isFinite(rawHeight)) {
      return;
    }

    updateAttributes({ height: clampHeight(rawHeight) });
  }

  function handleDelete() {
    try {
      deleteNode();
    } catch {
      editor.commands.deleteSelection();
    }
  }

  return (
    <NodeViewWrapper data-drag-handle className={classes.embedNodeView}>
      {embedUrl ? (
        <div
          ref={containerRef}
          className={clsx(classes.embedContainer, {
            [classes.selected]: selected,
            [classes.editable]: editor.isEditable,
          })}
        >
          {editor.isEditable && (
            <div
              className={classes.controls}
              contentEditable={false}
              onMouseDown={(e) => e.preventDefault()}
            >
              {/* URL edit is intentionally hidden for locked Figma embeds.
                  Only non-Figma providers (or an empty Figma slot) get the
                  URL editor. */}
              {!isFigmaLocked && (
                <Popover
                  width={360}
                  position="bottom-end"
                  withArrow
                  shadow="md"
                >
                  <Popover.Target>
                    <ActionIcon
                      variant="default"
                      size="sm"
                      aria-label={t("Edit embed")}
                    >
                      <IconEdit size={16} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown bg="var(--mantine-color-body)">
                    <form onSubmit={embedForm.onSubmit(onSubmit)}>
                      <FocusTrap active={true}>
                        <TextInput
                          label={t("Embed link")}
                          placeholder={t("Enter {{provider}} link to embed", {
                            provider: providerName,
                          })}
                          key={embedForm.key("url")}
                          {...embedForm.getInputProps("url")}
                          data-autofocus
                        />
                      </FocusTrap>

                      <Group justify="flex-end" mt="xs">
                        <Button type="submit" size="xs">
                          {t("Save")}
                        </Button>
                      </Group>
                    </form>
                  </Popover.Dropdown>
                </Popover>
              )}

              {isFigma && (
                <Popover
                  width={300}
                  position="bottom-end"
                  withArrow
                  shadow="md"
                >
                  <Popover.Target>
                    <ActionIcon
                      variant="default"
                      size="sm"
                      aria-label={t("Figma embed settings")}
                    >
                      <IconSettings size={16} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown bg="var(--mantine-color-body)">
                    <Switch
                      checked={isFitToScreen}
                      onChange={(event) =>
                        handleFitToScreenChange(event.currentTarget.checked)
                      }
                      label={t("Fit to screen")}
                    />
                    <Text size="xs" c="dimmed" mt={4}>
                      {t("Fit to screen breaks out of the centered column")}
                    </Text>

                    <Switch
                      mt="sm"
                      checked={showFigmaPages}
                      onChange={(event) =>
                        updateAttributes({
                          figmaPages: event.currentTarget.checked,
                        })
                      }
                      label={t("Show pages")}
                    />
                    <Text size="xs" c="dimmed" mt={4}>
                      {t("Page navigation like opening in a browser tab")}
                    </Text>

                    <Text size="sm" fw={500} mt="sm" mb={4}>
                      {t("Horizontal margin")}
                    </Text>
                    <Slider
                      min={MIN_MARGIN_X}
                      max={MAX_MARGIN_X}
                      step={4}
                      disabled={!isFitToScreen}
                      value={normalizedMarginX}
                      onChange={handleMarginChange}
                    />

                    <NumberInput
                      mt="sm"
                      label={t("Horizontal margin")}
                      min={MIN_MARGIN_X}
                      max={MAX_MARGIN_X}
                      step={4}
                      disabled={!isFitToScreen}
                      value={normalizedMarginX}
                      onChange={handleMarginChange}
                    />

                    <NumberInput
                      mt="sm"
                      label={t("Height")}
                      min={MIN_FIT_HEIGHT}
                      max={MAX_FIT_HEIGHT}
                      step={20}
                      value={normalizedHeight}
                      onChange={handleHeightChange}
                    />
                    <Text size="xs" c="dimmed" mt={4}>
                      {t("Tip: drag the bottom bar to resize the box height")}
                    </Text>
                  </Popover.Dropdown>
                </Popover>
              )}

              {isFigmaLocked && (
                <ActionIcon
                  variant="default"
                  size="sm"
                  aria-label={t("Delete")}
                  onClick={handleDelete}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </div>
          )}

          {isFigma && safeEmbedUrl ? (
            <>
              {isFitToScreen ? (
                <div ref={breakoutRef} className={classes.fitBreakout}>
                  <div
                    ref={fitBoxRef}
                    className={clsx(classes.fitEmbedWrapper, {
                      "ProseMirror-selectednode": selected,
                      [classes.resizing]: isHeightResizing,
                    })}
                    style={{
                      marginInline: `${normalizedMarginX}px`,
                      height: normalizedHeight,
                    }}
                  >
                    <div
                      className={classes.browserBar}
                      contentEditable={false}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <div className={classes.browserDots} aria-hidden="true">
                        <span className={classes.browserDot} />
                        <span className={classes.browserDot} />
                        <span className={classes.browserDot} />
                      </div>
                      <Text size="xs" c="dimmed" className={classes.browserTitle}>
                        {t("Figma embed")}
                      </Text>
                      <div className={classes.browserActions}>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label={t("Reload") as string}
                          onClick={() => setFigmaNonce((n) => n + 1)}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <IconRefresh size={14} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label={t("Open fullscreen") as string}
                          onClick={() => setFigmaFullscreen(true)}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <IconArrowsMaximize size={14} />
                        </ActionIcon>
                      </div>
                    </div>
                    <div className={classes.browserViewport}>
                      <iframe
                        key={`figma-fit-${figmaNonce}`}
                        className={classes.embedIframe}
                        src={figmaUrl}
                        title={t("Figma embed") as string}
                        allow={FIGMA_ALLOW}
                        loading="lazy"
                        sandbox={FIGMA_SANDBOX}
                        allowFullScreen
                        frameBorder="0"
                      />
                    </div>
                    {isHeightResizing && (
                      <div className={classes.resizeOverlay} />
                    )}
                    {editor.isEditable && (
                      <div
                        className={classes.fitResizeHandle}
                        onMouseDown={startHeightResize}
                        title={t("Drag to resize height") as string}
                      >
                        <div className={classes.fitResizeBar} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <ResizableWrapper
                  initialWidth={normalizedWidth}
                  initialHeight={normalizedHeight}
                  minWidth={200}
                  maxWidth={1200}
                  minHeight={200}
                  maxHeight={1200}
                  onResize={handleResize}
                  isEditable={editor.isEditable}
                  selected={selected}
                  className={clsx(classes.embedWrapper, {
                    "ProseMirror-selectednode": selected,
                  })}
                >
                  <div className={classes.figmaBrowserWrap}>
                    <div
                      className={classes.browserBar}
                      contentEditable={false}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <div className={classes.browserDots} aria-hidden="true">
                        <span className={classes.browserDot} />
                        <span className={classes.browserDot} />
                        <span className={classes.browserDot} />
                      </div>
                      <Text size="xs" c="dimmed" className={classes.browserTitle}>
                        {t("Figma embed")}
                      </Text>
                      <div className={classes.browserActions}>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label={t("Reload") as string}
                          onClick={() => setFigmaNonce((n) => n + 1)}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <IconRefresh size={14} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label={t("Open fullscreen") as string}
                          onClick={() => setFigmaFullscreen(true)}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <IconArrowsMaximize size={14} />
                        </ActionIcon>
                      </div>
                    </div>
                    <div className={classes.browserViewport}>
                      <iframe
                        key={`figma-fixed-${figmaNonce}`}
                        className={classes.embedIframe}
                        src={figmaUrl}
                        title={t("Figma embed") as string}
                        allow={FIGMA_ALLOW}
                        loading="lazy"
                        sandbox={FIGMA_SANDBOX}
                        allowFullScreen
                        frameBorder="0"
                      />
                    </div>
                  </div>
                </ResizableWrapper>
              )}
              <Modal
                opened={figmaFullscreen}
                onClose={() => setFigmaFullscreen(false)}
                fullScreen
                padding={0}
                title={t("Figma embed") as string}
              >
                <div className={classes.fullscreenViewport}>
                  <iframe
                    key={`figma-full-${figmaNonce}`}
                    className={classes.embedIframe}
                    src={figmaUrl}
                    title={t("Figma embed") as string}
                    allow={FIGMA_ALLOW}
                    loading="lazy"
                    sandbox={FIGMA_SANDBOX}
                    allowFullScreen
                    frameBorder="0"
                  />
                </div>
              </Modal>
            </>
          ) : safeEmbedUrl ? (
            <ResizableWrapper
              initialWidth={normalizedWidth}
              initialHeight={normalizedHeight}
              minWidth={200}
              maxWidth={1200}
              minHeight={200}
              maxHeight={1200}
              onResize={handleResize}
              isEditable={editor.isEditable}
              selected={selected}
              className={clsx(classes.embedWrapper, {
                "ProseMirror-selectednode": selected,
              })}
            >
              <iframe
                className={classes.embedIframe}
                src={figmaUrl}
                title={`${providerName} embed`}
                allow="encrypted-media; clipboard-read; clipboard-write; picture-in-picture; fullscreen"
                loading="lazy"
                sandbox={GENERIC_SANDBOX}
                allowFullScreen
                frameBorder="0"
              />
            </ResizableWrapper>
          ) : null}
        </div>
      ) : (
        <Popover
          width={300}
          position="bottom"
          withArrow
          shadow="md"
          disabled={!editor.isEditable}
        >
          <Popover.Target>
            <Card
              radius="md"
              p="xs"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
              withBorder
              className={clsx(selected ? "ProseMirror-selectednode" : "")}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <ActionIcon
                  variant="transparent"
                  color="gray"
                  aria-label={t("Edit embed")}
                >
                  <IconEdit size={18} />
                </ActionIcon>

                <Text component="span" size="lg" c="dimmed">
                  {t("Embed {{provider}}", {
                    provider: providerName,
                  })}
                </Text>
              </div>
            </Card>
          </Popover.Target>
          <Popover.Dropdown bg="var(--mantine-color-body)">
            <form onSubmit={embedForm.onSubmit(onSubmit)}>
              <FocusTrap active={true}>
                <TextInput
                  placeholder={t("Enter {{provider}} link to embed", {
                    provider: providerName,
                  })}
                  key={embedForm.key("url")}
                  {...embedForm.getInputProps("url")}
                  data-autofocus
                />
              </FocusTrap>

              <Group justify="center" mt="xs">
                <Button type="submit">{t("Embed link")}</Button>
              </Group>
            </form>
          </Popover.Dropdown>
        </Popover>
      )}
    </NodeViewWrapper>
  );
}
