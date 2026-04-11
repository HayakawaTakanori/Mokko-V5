import type { PartRecord, PartTemplate } from "./types";

export const PART_TEMPLATES: Record<string, PartTemplate> = {
  sidePanel: {
    id: "sidePanel",
    label: "側板",
    role: "side-panel",
    matId: "ply18",
    description: "左右側板。親の高さ・奥行きに追従する。",
    finishFormulas: {
      W: "$T",
      H: "$H",
      D: "$D",
    },
    marginFormulas: {
      W: "15",
      H: "15",
      D: "15",
    },
    defaultPositionFormulas: {
      x: "0",
      y: "0",
      w: "$T",
      h: "$H",
    },
  },
  topPanel: {
    id: "topPanel",
    label: "天板",
    role: "top-panel",
    matId: "ply18",
    description: "側板内寸に収まる天板。",
    finishFormulas: {
      W: "$W - ($T * 2)",
      H: "$T",
      D: "$D",
    },
    marginFormulas: {
      W: "15",
      H: "15",
      D: "15",
    },
    defaultPositionFormulas: {
      x: "$T",
      y: "0",
      w: "$W - ($T * 2)",
      h: "$T",
    },
  },
  bottomPanel: {
    id: "bottomPanel",
    label: "地板",
    role: "bottom-panel",
    matId: "ply18",
    description: "側板内寸に収まる地板。",
    finishFormulas: {
      W: "$W - ($T * 2)",
      H: "$T",
      D: "$D",
    },
    marginFormulas: {
      W: "15",
      H: "15",
      D: "15",
    },
    defaultPositionFormulas: {
      x: "$T",
      y: "$H - $T",
      w: "$W - ($T * 2)",
      h: "$T",
    },
  },
  shelfPanel: {
    id: "shelfPanel",
    label: "棚板",
    role: "shelf-panel",
    matId: "ply18",
    description: "可動棚想定。前後クリアランス 10mm を確保。",
    finishFormulas: {
      W: "$W - ($T * 2)",
      H: "$T",
      D: "$D - 10",
    },
    marginFormulas: {
      W: "15",
      H: "15",
      D: "15",
    },
    defaultPositionFormulas: {
      x: "$T",
      y: "$H / 2",
      w: "$W - ($T * 2)",
      h: "$T",
    },
  },
  backPanel: {
    id: "backPanel",
    label: "背板",
    role: "back-panel",
    matId: "back5",
    description: "背板。クリアランス考慮で内寸から控え。",
    finishFormulas: {
      W: "$W - ($T * 2) - 2",
      H: "$H - ($T * 2) - 2",
      D: "5",
    },
    marginFormulas: {
      W: "10",
      H: "10",
      D: "2",
    },
    defaultPositionFormulas: {
      x: "$T + 1",
      y: "$T + 1",
      w: "$W - ($T * 2) - 2",
      h: "$H - ($T * 2) - 2",
    },
  },
};

interface BuildPartFromTemplateInput {
  templateId: keyof typeof PART_TEMPLATES;
  id: string;
  parentId: string;
  name?: string;
  drawingNo: string;
  matId?: string;
}

export function buildPartFromTemplate(input: BuildPartFromTemplateInput): PartRecord {
  const template = PART_TEMPLATES[input.templateId];
  return {
    id: input.id,
    parentId: input.parentId,
    kind: "part",
    name: input.name ?? template.label,
    role: template.role,
    matId: input.matId ?? template.matId,
    drawingNo: input.drawingNo,
    finishFormulas: { ...template.finishFormulas },
    marginFormulas: { ...template.marginFormulas },
    positionFormulas: template.defaultPositionFormulas ? { ...template.defaultPositionFormulas } : undefined,
  };
}
