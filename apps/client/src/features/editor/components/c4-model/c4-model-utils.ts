import type {
  C4ElementKind,
  C4ModelData,
} from "@docmost/editor-ext";

export type C4Level = "context" | "container" | "component";

export const LEVELS: { level: C4Level; label: string }[] = [
  { level: "context", label: "Context" },
  { level: "container", label: "Container" },
  { level: "component", label: "Component" },
];

export interface PaletteItem {
  kind: C4ElementKind;
  label: string;
  color: string;
  external?: boolean;
}

export const PALETTE: Record<C4Level, PaletteItem[]> = {
  context: [
    { kind: "person", label: "Person", color: "#08427B" },
    { kind: "externalPerson", label: "External Person", color: "#8A8A8A", external: true },
    { kind: "system", label: "Software System", color: "#1168BD" },
    { kind: "externalSystem", label: "External System", color: "#999999", external: true },
  ],
  container: [
    { kind: "container", label: "Container", color: "#438DD5" },
    { kind: "externalContainer", label: "External Container", color: "#999999", external: true },
  ],
  component: [
    { kind: "component", label: "Component", color: "#85BBF0" },
    { kind: "externalComponent", label: "External Component", color: "#c1c1c1", external: true },
  ],
};

export interface ElementStyle {
  fill: string;
  stroke: string;
  text: string;
  external: boolean;
}

export function elementStyle(kind: C4ElementKind): ElementStyle {
  switch (kind) {
    case "person":
    case "system":
      return { fill: "#1168BD", stroke: "#08427B", text: "#ffffff", external: false };
    case "externalPerson":
    case "externalSystem":
      return { fill: "#999999", stroke: "#6E6E6E", text: "#ffffff", external: true };
    case "container":
      return { fill: "#438DD5", stroke: "#285E8E", text: "#ffffff", external: false };
    case "externalContainer":
      return { fill: "#a8a8a8", stroke: "#6E6E6E", text: "#ffffff", external: true };
    case "component":
      return { fill: "#85BBF0", stroke: "#438DD5", text: "#08427B", external: false };
    case "externalComponent":
      return { fill: "#c9c9c9", stroke: "#8A8A8A", text: "#08427B", external: true };
    default:
      return { fill: "#438DD5", stroke: "#285E8E", text: "#ffffff", external: false };
  }
}

export function isPerson(kind: C4ElementKind): boolean {
  return kind === "person" || kind === "externalPerson";
}

export function isDrillable(kind: C4ElementKind): boolean {
  return kind === "container" || kind === "system" || kind === "externalContainer";
}

export function isExternal(kind: C4ElementKind): boolean {
  return (
    kind === "externalPerson" ||
    kind === "externalSystem" ||
    kind === "externalContainer" ||
    kind === "externalComponent"
  );
}

export function allowedKindsForLevel(level: C4Level): C4ElementKind[] {
  return PALETTE[level].map((p) => p.kind);
}

export function kindLabel(kind: C4ElementKind): string {
  const all = [...PALETTE.context, ...PALETTE.container, ...PALETTE.component];
  const item = all.find((p) => p.kind === kind);
  return item ? item.label : kind;
}

let idCounter = 0;
export function genId(): string {
  idCounter += 1;
  return `c4-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function parseModel(json: string | undefined | null): C4ModelData {
  if (!json) {
    const fallback: C4ModelData = {
      name: "My software system",
      description: "",
      context: { elements: [], relations: [] },
      containerScope: { elements: [], relations: [] },
    };
    return fallback;
  }
  try {
    const parsed = JSON.parse(json) as C4ModelData;
    parsed.context = parsed.context || { elements: [], relations: [] };
    parsed.containerScope = parsed.containerScope || { elements: [], relations: [] };
    parsed.context.elements = parsed.context.elements || [];
    parsed.context.relations = parsed.context.relations || [];
    parsed.containerScope.elements = parsed.containerScope.elements || [];
    parsed.containerScope.relations = parsed.containerScope.relations || [];
    return parsed;
  } catch {
    const fallback: C4ModelData = {
      name: "My software system",
      description: "",
      context: { elements: [], relations: [] },
      containerScope: { elements: [], relations: [] },
    };
    return fallback;
  }
}

export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
      continue;
    }
    if ((current + " " + word).length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

export function elementSize(
  name: string,
  description?: string,
  technology?: string,
): { w: number; h: number } {
  const nameLines = wrapText(name || "Unnamed", 24).length;
  const techLines = technology ? Math.min(wrapText(technology, 24).length, 1) : 0;
  const descPart = description
    ? Math.min(wrapText(description, 28).length, 2)
    : 0;
  const h = 42 + Math.max(nameLines, 1) * 16 + techLines * 12 + descPart * 14 + 18;
  return { w: 220, h: Math.max(h, 80) };
}