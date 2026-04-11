export type DimensionKey = "W" | "H" | "D" | "T";

export type ScalarVariables = Record<string, number>;

export interface FormulaDimensionSet {
  W?: string | number;
  H?: string | number;
  D?: string | number;
  T?: string | number;
}

export interface PositionFormulaSet {
  x?: string | number;
  y?: string | number;
  w?: string | number;
  h?: string | number;
}

export interface ComponentRecord {
  id: string;
  kind: "component";
  name: string;
  parentId: string | null;
  drawingNo?: string;
  variables: Partial<Record<DimensionKey, number>>;
  finishFormulas?: FormulaDimensionSet;
  marginFormulas?: FormulaDimensionSet;
  positionFormulas?: PositionFormulaSet;
  localVariables?: ScalarVariables;
}

export interface PartRecord {
  id: string;
  parentId: string;
  kind: "part";
  name: string;
  role: string;
  matId: string;
  drawingNo: string;
  finishFormulas: FormulaDimensionSet;
  marginFormulas: FormulaDimensionSet;
  positionFormulas?: PositionFormulaSet;
  localVariables?: ScalarVariables;
}

export type FlatRecord = ComponentRecord | PartRecord;
export type FlatComponent = ComponentRecord;
export type FlatPart = PartRecord;

export interface FormulaScope {
  /**
   * Parent/component variables. Keys may be provided as "W" or "$W".
   */
  variables: ScalarVariables;
}

export interface ResolvedDimensions {
  finish: Partial<Record<DimensionKey, number>>;
  margin: Partial<Record<DimensionKey, number>>;
  order: Partial<Record<DimensionKey, number>>;
}
