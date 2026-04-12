import { resolvePartDimensions } from "./dimensionResolver";
import { buildPartFromTemplate } from "./partTemplates";
import type { ComponentRecord, FormulaScope, PartRecord } from "./types";

const cabinetRootScope: FormulaScope = {
  variables: {
    W: 900,
    H: 720,
    D: 450,
    T: 18,
  },
};

const cabinet: ComponentRecord = {
  id: "cabinet-001",
  name: "箱本体",
  kind: "component",
  variables: {
    W: 900,
    H: 720,
    D: 450,
    T: 18,
  },
};

const leftSidePanel: PartRecord = {
  id: "part-left-side",
  name: "左側板",
  parentId: cabinet.id,
  role: "side-left",
  matId: "ply18",
  drawingNo: "WB-0001",
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
  positionFormulas: {
    x: "0",
    y: "0",
    w: "$T",
    h: "$H",
  },
};

const resolved = resolvePartDimensions(leftSidePanel, cabinetRootScope);
console.log(resolved);

const topPanelFromTemplate = buildPartFromTemplate({
  templateId: "topPanel",
  id: "part-top-001",
  parentId: cabinet.id,
  drawingNo: "WB-0002",
});

const resolvedTop = resolvePartDimensions(topPanelFromTemplate, cabinetRootScope);
console.log(resolvedTop);
