import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { sanitizeUrl } from "./utils";

export interface EmbedOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}
export interface EmbedAttributes {
  src?: string;
  provider: string;
  align?: string;
  width?: number | null;
  height?: number | null;
  fitToScreen?: boolean;
  marginX?: number;
  figmaPages?: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeds: {
      setEmbed: (attributes?: EmbedAttributes) => ReturnType;
    };
  }
}

export const Embed = Node.create<EmbedOptions>({
  name: "embed",
  inline: false,
  group: "block",
  isolating: true,
  atom: true,
  defining: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },
  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element) => {
          const src = element.getAttribute("data-src");
          return sanitizeUrl(src);
        },
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-src": sanitizeUrl(attributes.src),
        }),
      },
      provider: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-provider"),
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-provider": attributes.provider,
        }),
      },
      align: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align"),
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-align": attributes.align,
        }),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-width");
          if (!raw) return null;
          const width = parseFloat(raw);
          return Number.isFinite(width) ? width : null;
        },
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-width": attributes.width,
        }),
      },
      height: {
        default: 600,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-height");
          if (!raw) return null;
          const height = parseFloat(raw);
          return Number.isFinite(height) ? height : null;
        },
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-height": attributes.height,
        }),
      },
      fitToScreen: {
        default: false,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-fit-to-screen");
          if (raw === null) {
            return element.getAttribute("data-provider") === "figma";
          }
          return raw === "true";
        },
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-fit-to-screen": attributes.fitToScreen ? "true" : "false",
        }),
      },
      marginX: {
        default: 0,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-margin-x");
          if (!raw) return 0;
          const marginX = parseFloat(raw);
          return Number.isFinite(marginX) ? marginX : 0;
        },
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-margin-x": attributes.marginX,
        }),
      },
      figmaPages: {
        default: true,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-figma-pages");
          if (raw === null) return true;
          return raw === "true";
        },
        renderHTML: (attributes: EmbedAttributes) => ({
          "data-figma-pages": attributes.figmaPages !== false ? "true" : "false",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes["data-src"];
    const safeHref = sanitizeUrl(src);
    const provider = HTMLAttributes["data-provider"];
    const fallbackLabel = provider
      ? `${provider} embed`
      : "Embedded content";

    return [
      "div",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      [
        "a",
        {
          href: safeHref,
          target: "_blank",
          rel: "noopener noreferrer",
        },
        fallbackLabel,
      ],
    ];
  },

  addCommands() {
    return {
      setEmbed:
        (attrs: EmbedAttributes) =>
        ({ commands }) => {
          const normalizedAttrs = { ...attrs };

          if (normalizedAttrs.provider?.toLowerCase() === "figma") {
            if (normalizedAttrs.fitToScreen === undefined) {
              normalizedAttrs.fitToScreen = true;
            }
            if (normalizedAttrs.figmaPages === undefined) {
              normalizedAttrs.figmaPages = true;
            }
            if (normalizedAttrs.marginX === undefined) {
              normalizedAttrs.marginX = 0;
            }
            if (normalizedAttrs.width === undefined) {
              normalizedAttrs.width = null;
            }
            if (normalizedAttrs.height === undefined) {
              normalizedAttrs.height = 600;
            }
          }

          // Validate the URL before inserting
          const validatedAttrs = {
            ...normalizedAttrs,
            src: sanitizeUrl(normalizedAttrs.src),
          };

          return commands.insertContent({
            type: "embed",
            attrs: validatedAttrs,
          });
        },
    };
  },

  addNodeView() {
    // Force the react node view to render immediately using flush sync (https://github.com/ueberdosis/tiptap/blob/b4db352f839e1d82f9add6ee7fb45561336286d8/packages/react/src/ReactRenderer.tsx#L183-L191)
    this.editor.isInitialized = true;

    return ReactNodeViewRenderer(this.options.view);
  },
});
