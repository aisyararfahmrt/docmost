import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createEmptyModelData } from "./types";

export interface C4ModelOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

export interface C4ModelAttributes {
  name: string;
  description: string;
  data: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    c4Model: {
      setC4Model: (attributes?: Partial<C4ModelAttributes>) => ReturnType;
    };
  }
}

export const C4Model = Node.create<C4ModelOptions>({
  name: "c4Model",
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
      name: {
        default: "My software system",
        parseHTML: (element) => element.getAttribute("data-c4-name"),
        renderHTML: (attributes) => ({
          "data-c4-name": attributes.name,
        }),
      },
      description: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-c4-description"),
        renderHTML: (attributes) => ({
          "data-c4-description": attributes.description,
        }),
      },
      data: {
        default: JSON.stringify(createEmptyModelData()),
        parseHTML: (element) =>
          element.getAttribute("data-c4-data") ||
          JSON.stringify(createEmptyModelData()),
        renderHTML: (attributes) => ({
          "data-c4-data": attributes.data,
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
    return [
      "div",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
    ];
  },

  addCommands() {
    return {
      setC4Model:
        (attrs: Partial<C4ModelAttributes>) =>
        ({ commands }) => {
          const model = attrs?.data
            ? attrs.data
            : JSON.stringify(createEmptyModelData());
          return commands.insertContent({
            type: "c4Model",
            attrs: {
              name: attrs?.name || "My software system",
              description: attrs?.description || "",
              data: model,
            },
          });
        },
    };
  },

  addNodeView() {
    this.editor.isInitialized = true;
    return ReactNodeViewRenderer(this.options.view);
  },
});