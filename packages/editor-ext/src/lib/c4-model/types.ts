export type C4ElementKind =
  | "person"
  | "system"
  | "externalPerson"
  | "externalSystem"
  | "container"
  | "externalContainer"
  | "component"
  | "externalComponent";

export interface C4Elem {
  id: string;
  kind: C4ElementKind;
  name: string;
  description?: string;
  technology?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface C4ContainerElem extends C4Elem {
  componentScope: C4Scope;
}

export type C4ArrowType = "none" | "start" | "end" | "both";

/**
 * A normalized anchor point (0..1 on each axis) inside an element box.
 * Used to attach a relation to any point on any side of an element. The
 * actual boundary point is computed by shooting a ray from the element
 * center through this normalized point and taking its intersection with
 * the element's rectangle edge.
 */
export interface C4Anchor {
  x: number;
  y: number;
}

export interface C4Point {
  x: number;
  y: number;
}

export interface C4Relation {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  technology?: string;
  arrow?: C4ArrowType;
  fromAnchor?: C4Anchor;
  toAnchor?: C4Anchor;
  labelPos?: number;
  waypoints?: C4Point[];
}

export interface C4Scope {
  elements: C4Elem[];
  relations: C4Relation[];
}

export interface C4ContainerScope extends C4Scope {
  elements: C4ContainerElem[];
}

export interface C4ModelData {
  name: string;
  description: string;
  context: C4Scope;
  containerScope: C4ContainerScope;
}

export const EMPTY_MODEL_DATA: C4ModelData = {
  name: "My software system",
  description: "",
  context: { elements: [], relations: [] },
  containerScope: { elements: [], relations: [] },
};

export function createEmptyModelData(name = "My software system"): C4ModelData {
  return {
    name,
    description: "",
    context: { elements: [], relations: [] },
    containerScope: { elements: [], relations: [] },
  };
}