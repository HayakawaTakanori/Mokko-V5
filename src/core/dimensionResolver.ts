import { evaluateFormula } from "./formulaEvaluator";
import type {
  DimensionKey,
  FlatComponent,
  FormulaDimensionSet,
  FormulaScope,
  ResolvedDimensions,
  ScalarVariables,
} from "./types";

const DIMENSION_KEYS: DimensionKey[] = ["W", "H", "D", "T"];

function resolveDimensionSet(
  formulas: FormulaDimensionSet,
  variables: ScalarVariables
): Partial<Record<DimensionKey, number>> {
  const out: Partial<Record<DimensionKey, number>> = {};
  DIMENSION_KEYS.forEach((key) => {
    const source = formulas[key];
    if (source === undefined) return;
    out[key] = evaluateFormula(source, variables);
  });
  return out;
}

/**
 * Resolve finish/margin/order dimensions while keeping finish and margin separated.
 */
export function resolveComponentDimensions(
  component: FlatComponent,
  scope: FormulaScope
): ResolvedDimensions {
  const mergedVariables: ScalarVariables = {
    ...scope.variables,
    ...(component.localVariables ?? {}),
  };

  const finish = resolveDimensionSet(component.finishFormulas, mergedVariables);
  const margin = resolveDimensionSet(component.marginFormulas, mergedVariables);

  const order: Partial<Record<DimensionKey, number>> = {};
  DIMENSION_KEYS.forEach((key) => {
    const finishValue = finish[key];
    const marginValue = margin[key] ?? 0;
    if (finishValue === undefined && marginValue === 0) return;
    order[key] = (finishValue ?? 0) + marginValue;
  });

  return { finish, margin, order };
}
