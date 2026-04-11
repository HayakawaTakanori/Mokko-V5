import { resolveComponentDimensions } from "./dimensionResolver";
import type { FlatComponent, FormulaScope } from "./types";

const cabinetRootScope: FormulaScope = {
  variables: {
    W: 900,
    H: 720,
    D: 450,
    T: 18,
  },
};

const leftSidePanel: FlatComponent = {
  id: "part-left-side",
  name: "左側板",
  kind: "part",
  parentId: "cabinet-001",
  finishFormulas: {
    W: "$T",
    H: "$H",
    D: "$D",
  },
  marginFormulas: {
    W: "10",
    H: "10",
    D: "10",
  },
};

const resolved = resolveComponentDimensions(leftSidePanel, cabinetRootScope);
console.log(resolved);
