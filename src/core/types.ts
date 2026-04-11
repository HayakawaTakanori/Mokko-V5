export type DimensionKey = "W" | "H" | "D" | "T";

export type ScalarVariables = Record<string, number>;

export interface FormulaDimensionSet {
  W?: string | number;
  H?: string | number;
  D?: string | number;
  T?: string | number;
}

export interface FlatComponent {
  /**
   * Stable unique id for references.
   */
  id: string;
  name: string;
  kind: "assembly" | "part";
  parentId: string | null;

  /**
   * Finish size (仕上がり寸法) formulas.
   * Every expression should reference parent variables ($W, $H, $D, $T).
   */
  finishFormulas: FormulaDimensionSet;

  /**
   * Margin (伸び寸法) formulas for quotation/procurement.
   * Kept separate from finishFormulas by design.
   */
  marginFormulas: FormulaDimensionSet;

  /**
   * Optional local constants for this component (e.g. SIDE_T = 18).
   */
  localVariables?: ScalarVariables;
}

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
