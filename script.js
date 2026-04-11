const DEFAULT_MARGIN_MM = 15;
const MIN_DRAW_SIZE_MM = 20;
const SNAP_DISTANCE_PX = 12;
const DRAWING_NO_PREFIX = "WB-";

const MATERIALS = {
  ply20Laminate: { label: "積層20", thicknessFormula: "2.5 + 15 + 2.5" },
  back5: { label: "背板5", thicknessFormula: "5" },
};

const PART_TEMPLATES = {
  sidePanel: {
    id: "sidePanel",
    label: "側板",
    role: "side-panel",
    matId: "ply20Laminate",
    orientation: "vertical",
    frontViewMode: "edge",
  },
  topPanel: {
    id: "topPanel",
    label: "天板",
    role: "top-panel",
    matId: "ply20Laminate",
    orientation: "horizontal",
    frontViewMode: "edge",
  },
  bottomPanel: {
    id: "bottomPanel",
    label: "地板",
    role: "bottom-panel",
    matId: "ply20Laminate",
    orientation: "horizontal",
    frontViewMode: "edge",
  },
  shelfPanel: {
    id: "shelfPanel",
    label: "中棚",
    role: "shelf-panel",
    matId: "ply20Laminate",
    orientation: "auto",
    frontViewMode: "edge",
  },
  backPanel: {
    id: "backPanel",
    label: "背板",
    role: "back-panel",
    matId: "back5",
    orientation: "sheet",
    frontViewMode: "face",
  },
  doorPanel: {
    id: "doorPanel",
    label: "扉",
    role: "door-panel",
    matId: "ply20Laminate",
    orientation: "sheet",
    frontViewMode: "face",
  },
  drawerFrontPanel: {
    id: "drawerFrontPanel",
    label: "引き出し前板",
    role: "drawer-front-panel",
    matId: "ply20Laminate",
    orientation: "sheet",
    frontViewMode: "face",
  },
};

const stageContainer = document.getElementById("stage-container");
const partsListEl = document.getElementById("parts-list");
const summaryListEl = document.getElementById("summary-list");
const hudStateEl = document.getElementById("hud-state");
const templateSelectEl = document.getElementById("template-select");
const cabinetWidthEl = document.getElementById("cabinet-width");
const cabinetHeightEl = document.getElementById("cabinet-height");
const cabinetDepthEl = document.getElementById("cabinet-depth");
const applyCabinetBtn = document.getElementById("apply-cabinet-btn");
const modeSelectEl = document.getElementById("draw-mode-select");

let stage;
let layer;
let tr;
let cabinetFrameNode = null;
let cabinetLabelNode = null;
let isDrawing = false;
let startSnap = null;
let currentLocalRect = null;
let currentTraceMeta = null;
let activeGuideLine = null;
let guideDragStart = null;
let guidePreviewNode = null;
let selectedNode = null;
let draftRect = null;
let draftText = null;
let draftRayLine = null;
let constraintOverlay = null;
let lastHudOperation = "move";
const keyBuffer = { text: "" };
const boards = [];
const guideLines = [];
let guideCounter = 1;
let boardCounter = 1;

const cabinetModel = {
  x: 60,
  y: 60,
  W: 900,
  H: 720,
  D: 450,
  scale: 1,
};

class FormulaSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}

class FormulaEvaluationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormulaEvaluationError";
  }
}

function tokenizeFormula(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (["+","-","*","/","(",")"].includes(ch)) {
      tokens.push({ type: ch });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = ch;
      i += 1;
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i];
        i += 1;
      }
      if ((num.match(/\./g) || []).length > 1 || num === ".") throw new FormulaSyntaxError("Invalid number literal");
      tokens.push({ type: "number", value: Number(num) });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let ident = ch;
      i += 1;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        ident += input[i];
        i += 1;
      }
      tokens.push({ type: "identifier", value: ident });
      continue;
    }
    throw new FormulaSyntaxError(`Unsupported character "${ch}"`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

function parseFormulaExpression(formula) {
  const tokens = tokenizeFormula(formula);
  let index = 0;
  function current() {
    return tokens[index];
  }
  function eat(type) {
    if (current().type !== type) throw new FormulaSyntaxError(`Expected "${type}" but got "${current().type}"`);
    index += 1;
  }
  function parsePrimary() {
    const token = current();
    if (token.type === "number") {
      eat("number");
      return { kind: "number", value: token.value };
    }
    if (token.type === "identifier") {
      eat("identifier");
      return { kind: "identifier", value: token.value };
    }
    if (token.type === "(") {
      eat("(");
      const node = parseAddSub();
      eat(")");
      return node;
    }
    throw new FormulaSyntaxError("Expected number, identifier, or parenthesis");
  }
  function parseUnary() {
    if (current().type === "+" || current().type === "-") {
      const op = current().type;
      eat(op);
      return { kind: "unary", op, right: parseUnary() };
    }
    return parsePrimary();
  }
  function parseMulDiv() {
    let node = parseUnary();
    while (current().type === "*" || current().type === "/") {
      const op = current().type;
      eat(op);
      node = { kind: "binary", op, left: node, right: parseUnary() };
    }
    return node;
  }
  function parseAddSub() {
    let node = parseMulDiv();
    while (current().type === "+" || current().type === "-") {
      const op = current().type;
      eat(op);
      node = { kind: "binary", op, left: node, right: parseMulDiv() };
    }
    return node;
  }
  const ast = parseAddSub();
  if (current().type !== "eof") throw new FormulaSyntaxError("Unexpected tokens in formula");
  return ast;
}

function evaluateAst(node, vars) {
  if (node.kind === "number") return node.value;
  if (node.kind === "identifier") {
    const key = node.value.startsWith("$") ? node.value.slice(1) : node.value;
    const value = vars[node.value] ?? vars[key] ?? vars[`$${key}`];
    if (value === undefined) throw new FormulaEvaluationError(`Unknown variable "${node.value}"`);
    return value;
  }
  if (node.kind === "unary") {
    const v = evaluateAst(node.right, vars);
    return node.op === "-" ? -v : v;
  }
  if (node.kind === "binary") {
    const left = evaluateAst(node.left, vars);
    const right = evaluateAst(node.right, vars);
    if (node.op === "+") return left + right;
    if (node.op === "-") return left - right;
    if (node.op === "*") return left * right;
    if (right === 0) throw new FormulaEvaluationError("Division by zero");
    return left / right;
  }
  throw new FormulaEvaluationError("Invalid AST node");
}

function evaluateFormula(formula, variables) {
  const source = `${formula}`.trim();
  if (!source) throw new FormulaSyntaxError("Formula cannot be empty");
  const ast = parseFormulaExpression(source);
  const out = evaluateAst(ast, variables);
  if (!Number.isFinite(out)) throw new FormulaEvaluationError("Result is not finite");
  return out;
}

function normalizeDecimalComma(source) {
  return source.replace(/(\d),(\d)/g, "$1.$2");
}

function resolveDimensionSet(formulas, variables) {
  const out = {};
  ["W", "H", "D", "T"].forEach((k) => {
    if (formulas[k] === undefined) return;
    out[k] = evaluateFormula(formulas[k], variables);
  });
  return out;
}

function resolvePartDimensions(part) {
  const vars = { $W: cabinetModel.W, $H: cabinetModel.H, $D: cabinetModel.D, $T: part.thickness };
  const finish = resolveDimensionSet(part.finishFormulas, vars);
  const margin = resolveDimensionSet(part.marginFormulas, vars);
  return {
    finish,
    margin,
    order: {
      W: (finish.W ?? 0) + (margin.W ?? 0),
      H: (finish.H ?? 0) + (margin.H ?? 0),
      D: (finish.D ?? 0) + (margin.D ?? 0),
    },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  const eps = 0.001;
  return a.x + eps < b.x + b.width && a.x + a.width > b.x + eps && a.y + eps < b.y + b.height && a.y + a.height > b.y + eps;
}

function overlapsAnyOtherBoard(candidateRect, currentBoardId) {
  return boards.some((item) => item.id !== currentBoardId && rectsOverlap(candidateRect, item.localRect));
}

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function formatMm(value) {
  return `${Math.round(value * 10) / 10}`;
}

function dimsLabel(width, height) {
  return `${Math.round(width)} x ${Math.round(height)} mm`;
}

function mmToPx(mm) {
  return mm * cabinetModel.scale;
}

function pxToMm(px) {
  return px / cabinetModel.scale;
}

function localToStagePoint(local) {
  return { x: cabinetModel.x + mmToPx(local.x), y: cabinetModel.y + mmToPx(local.y) };
}

function stageToLocalPoint(point) {
  return { x: pxToMm(point.x - cabinetModel.x), y: pxToMm(point.y - cabinetModel.y) };
}

function localRectToStageRect(localRect) {
  const p = localToStagePoint({ x: localRect.x, y: localRect.y });
  return { x: p.x, y: p.y, width: mmToPx(localRect.width), height: mmToPx(localRect.height) };
}

function parseInputValue(el, fallback) {
  const value = Number(el.value);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function getTemplate(templateId) {
  return PART_TEMPLATES[templateId] || PART_TEMPLATES.sidePanel;
}

function getTemplateThickness(templateId) {
  const template = getTemplate(templateId);
  const material = MATERIALS[template.matId];
  const rawFormula = material?.thicknessFormula || "18";
  const normalizedFormula = normalizeDecimalComma(rawFormula);
  try {
    return evaluateFormula(normalizedFormula, {});
  } catch (error) {
    return 18;
  }
}

function getTemplateForDrawing() {
  return getTemplate(templateSelectEl.value);
}

function inferLineOrientation(start, current) {
  if (!start || !current) return "horizontal";
  const dx = Math.abs(current.x - start.x);
  const dy = Math.abs(current.y - start.y);
  return dx >= dy ? "horizontal" : "vertical";
}

function resolveTemplateOrientation(templateId, start, current, localRect, orientationOverride) {
  if (orientationOverride) return orientationOverride;
  const template = getTemplate(templateId);
  if (template.orientation === "sheet") return "sheet";
  if (start && current) return inferLineOrientation(start, current);
  if (template.orientation !== "auto") return template.orientation;
  if (localRect) return localRect.width >= localRect.height ? "horizontal" : "vertical";
  return "horizontal";
}

function getCurrentMode() {
  return modeSelectEl?.value === "guide" ? "guide" : "part";
}

function createGuideLineNode(guide) {
  const points =
    guide.orientation === "vertical"
      ? [localToStagePoint({ x: guide.value, y: 0 }).x, localToStagePoint({ x: 0, y: 0 }).y, localToStagePoint({ x: guide.value, y: cabinetModel.H }).x, localToStagePoint({ x: 0, y: cabinetModel.H }).y]
      : [localToStagePoint({ x: 0, y: guide.value }).x, localToStagePoint({ x: 0, y: 0 }).y, localToStagePoint({ x: cabinetModel.W, y: guide.value }).x, localToStagePoint({ x: cabinetModel.W, y: 0 }).y];
  const line = new Konva.Line({
    points,
    stroke: "#6366f1",
    strokeWidth: 1.5,
    dash: [6, 4],
    listening: false,
    name: "guide-line",
  });
  return line;
}

function updateGuideLineNode(guide) {
  if (!guide.node) return;
  const points =
    guide.orientation === "vertical"
      ? [localToStagePoint({ x: guide.value, y: 0 }).x, localToStagePoint({ x: 0, y: 0 }).y, localToStagePoint({ x: guide.value, y: cabinetModel.H }).x, localToStagePoint({ x: 0, y: cabinetModel.H }).y]
      : [localToStagePoint({ x: 0, y: guide.value }).x, localToStagePoint({ x: 0, y: 0 }).y, localToStagePoint({ x: cabinetModel.W, y: guide.value }).x, localToStagePoint({ x: cabinetModel.W, y: 0 }).y];
  guide.node.points(points);
}

function clearGuides() {
  guideLines.forEach((guide) => {
    if (guide.node) guide.node.destroy();
  });
  guideLines.length = 0;
  if (guidePreviewNode) {
    guidePreviewNode.destroy();
    guidePreviewNode = null;
  }
}

function getEdgeCandidates(localPoint) {
  const edges = [];
  const rects = [{ x: 0, y: 0, width: cabinetModel.W, height: cabinetModel.H }, ...boards.map((b) => b.localRect)];
  rects.forEach((rect) => {
    edges.push({ orientation: "vertical", value: rect.x });
    edges.push({ orientation: "vertical", value: rect.x + rect.width });
    edges.push({ orientation: "horizontal", value: rect.y });
    edges.push({ orientation: "horizontal", value: rect.y + rect.height });
  });
  const tolerance = pxToMm(SNAP_DISTANCE_PX) * 1.5;
  let best = null;
  edges.forEach((edge) => {
    const distance = edge.orientation === "vertical" ? Math.abs(localPoint.x - edge.value) : Math.abs(localPoint.y - edge.value);
    if (distance > tolerance) return;
    if (!best || distance < best.distance) best = { ...edge, distance };
  });
  return best;
}

function beginGuideDraw() {
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const local = stageToLocalPoint(pointer);
  if (local.x < 0 || local.y < 0 || local.x > cabinetModel.W || local.y > cabinetModel.H) return;
  const edge = getEdgeCandidates(local);
  if (!edge) return;
  guideDragStart = edge;
  if (!guidePreviewNode) {
    guidePreviewNode = new Konva.Line({
      stroke: "#4f46e5",
      strokeWidth: 1.5,
      dash: [4, 3],
      listening: false,
      opacity: 0.75,
    });
    layer.add(guidePreviewNode);
  }
}

function continueGuideDraw() {
  if (!guideDragStart || !guidePreviewNode) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const local = stageToLocalPoint(pointer);
  const value = guideDragStart.orientation === "vertical" ? clamp(local.x, 0, cabinetModel.W) : clamp(local.y, 0, cabinetModel.H);
  const guide = { orientation: guideDragStart.orientation, value };
  const tempNode = { points: () => {} };
  guide.node = tempNode;
  const points =
    guide.orientation === "vertical"
      ? [localToStagePoint({ x: guide.value, y: 0 }).x, localToStagePoint({ x: 0, y: 0 }).y, localToStagePoint({ x: guide.value, y: cabinetModel.H }).x, localToStagePoint({ x: 0, y: cabinetModel.H }).y]
      : [localToStagePoint({ x: 0, y: guide.value }).x, localToStagePoint({ x: 0, y: 0 }).y, localToStagePoint({ x: cabinetModel.W, y: guide.value }).x, localToStagePoint({ x: cabinetModel.W, y: 0 }).y];
  guidePreviewNode.points(points);
  layer.batchDraw();
}

function endGuideDraw() {
  if (!guideDragStart) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) {
    guideDragStart = null;
    return;
  }
  const local = stageToLocalPoint(pointer);
  const value = guideDragStart.orientation === "vertical" ? clamp(local.x, 0, cabinetModel.W) : clamp(local.y, 0, cabinetModel.H);
  const guide = {
    id: `guide-${guideLines.length + 1}`,
    orientation: guideDragStart.orientation,
    value,
    expr: formatMm(value),
    node: null,
  };
  guide.node = createGuideLineNode(guide);
  guideLines.push(guide);
  layer.add(guide.node);
  if (guidePreviewNode) {
    guidePreviewNode.points([]);
  }
  guideDragStart = null;
  layer.batchDraw();
}

function clearBoards() {
  boards.forEach((board) => board.node.destroy());
  boards.length = 0;
  selectedNode = null;
  tr.nodes([]);
  updatePartsList();
  refreshHud();
}

function drawCabinetFrame(resetBoards) {
  cabinetModel.W = parseInputValue(cabinetWidthEl, cabinetModel.W);
  cabinetModel.H = parseInputValue(cabinetHeightEl, cabinetModel.H);
  cabinetModel.D = parseInputValue(cabinetDepthEl, cabinetModel.D);

  const pad = 80;
  const scaleX = (stage.width() - pad * 2) / cabinetModel.W;
  const scaleY = (stage.height() - pad * 2) / cabinetModel.H;
  cabinetModel.scale = Math.max(0.12, Math.min(scaleX, scaleY));
  const frameWidth = mmToPx(cabinetModel.W);
  const frameHeight = mmToPx(cabinetModel.H);
  cabinetModel.x = (stage.width() - frameWidth) / 2;
  cabinetModel.y = (stage.height() - frameHeight) / 2;

  if (!cabinetFrameNode) {
    cabinetFrameNode = new Konva.Rect({
      stroke: "#111827",
      strokeWidth: 2,
      fill: "rgba(148,163,184,0.04)",
      cornerRadius: 2,
      name: "cabinet-frame",
    });
    layer.add(cabinetFrameNode);
  }
  if (!cabinetLabelNode) {
    cabinetLabelNode = new Konva.Text({
      fontSize: 13,
      fontStyle: "bold",
      fill: "#111827",
      listening: false,
    });
    layer.add(cabinetLabelNode);
  }

  cabinetFrameNode.position({ x: cabinetModel.x, y: cabinetModel.y });
  cabinetFrameNode.size({ width: frameWidth, height: frameHeight });
  cabinetLabelNode.position({ x: cabinetModel.x + 4, y: cabinetModel.y - 20 });
  cabinetLabelNode.text(`Cabinet W:${Math.round(cabinetModel.W)} H:${Math.round(cabinetModel.H)} D:${Math.round(cabinetModel.D)} mm`);

  if (resetBoards) {
    clearBoards();
  } else {
    boards.forEach((board) => applyLocalRectToNode(board, board.localRect));
  }
  guideLines.forEach((guide) => updateGuideLineNode(guide));
  cabinetFrameNode.moveToBottom();
  layer.batchDraw();
}

function clampLocalRect(rect) {
  const w = clamp(rect.width, MIN_DRAW_SIZE_MM, cabinetModel.W);
  const h = clamp(rect.height, MIN_DRAW_SIZE_MM, cabinetModel.H);
  return {
    x: clamp(rect.x, 0, cabinetModel.W - w),
    y: clamp(rect.y, 0, cabinetModel.H - h),
    width: w,
    height: h,
  };
}

function buildSnapCandidatesLocal() {
  const x = [
    { value: 0, expr: "0" },
    { value: cabinetModel.W / 3, expr: "$W / 3" },
    { value: cabinetModel.W / 2, expr: "$W / 2" },
    { value: (cabinetModel.W * 2) / 3, expr: "($W * 2) / 3" },
    { value: cabinetModel.W, expr: "$W" },
  ];
  const y = [
    { value: 0, expr: "0" },
    { value: cabinetModel.H / 3, expr: "$H / 3" },
    { value: cabinetModel.H / 2, expr: "$H / 2" },
    { value: (cabinetModel.H * 2) / 3, expr: "($H * 2) / 3" },
    { value: cabinetModel.H, expr: "$H" },
  ];

  boards.forEach((board) => {
    const p = board.positionFormulas;
    const r = board.localRect;
    x.push(
      { value: r.x, expr: p.x },
      { value: r.x + r.width, expr: `(${p.x}) + (${p.w})` },
      { value: r.x + r.width / 2, expr: `(${p.x}) + ((${p.w}) / 2)` }
    );
    y.push(
      { value: r.y, expr: p.y },
      { value: r.y + r.height, expr: `(${p.y}) + (${p.h})` },
      { value: r.y + r.height / 2, expr: `(${p.y}) + ((${p.h}) / 2)` }
    );
  });

  guideLines.forEach((guide) => {
    if (guide.orientation === "vertical") {
      x.push({ value: guide.value, expr: guide.expr });
    } else {
      y.push({ value: guide.value, expr: guide.expr });
    }
  });
  return { x, y };
}

function snapLocalPoint(localPoint) {
  const snapDistanceMm = pxToMm(SNAP_DISTANCE_PX);
  const candidates = buildSnapCandidatesLocal();
  const snapped = {
    x: localPoint.x,
    y: localPoint.y,
    snappedX: false,
    snappedY: false,
    refXValue: localPoint.x,
    refYValue: localPoint.y,
    refXExpr: formatMm(localPoint.x),
    refYExpr: formatMm(localPoint.y),
  };

  let bestX = null;
  candidates.x.forEach((candidate) => {
    const d = Math.abs(localPoint.x - candidate.value);
    if (d > snapDistanceMm) return;
    if (!bestX || d < bestX.d) bestX = { ...candidate, d };
  });
  if (bestX) {
    snapped.x = bestX.value;
    snapped.refXValue = bestX.value;
    snapped.refXExpr = bestX.expr;
    snapped.snappedX = true;
  }

  let bestY = null;
  candidates.y.forEach((candidate) => {
    const d = Math.abs(localPoint.y - candidate.value);
    if (d > snapDistanceMm) return;
    if (!bestY || d < bestY.d) bestY = { ...candidate, d };
  });
  if (bestY) {
    snapped.y = bestY.value;
    snapped.refYValue = bestY.value;
    snapped.refYExpr = bestY.expr;
    snapped.snappedY = true;
  }
  return snapped;
}

function boundaryExprDifference(positiveExpr, negativeExpr) {
  if (negativeExpr === "0") return `${positiveExpr}`;
  return `(${positiveExpr}) - (${negativeExpr})`;
}

function collectExpansionBoundaries(axis, fixedCoord) {
  const epsilon = 0.2;
  const boundaries = [];
  if (axis === "vertical") {
    boundaries.push(
      { value: 0, expr: "0", source: "parent" },
      { value: cabinetModel.H, expr: "$H", source: "parent" }
    );
    boards.forEach((board) => {
      const r = board.localRect;
      if (fixedCoord < r.x - epsilon || fixedCoord > r.x + r.width + epsilon) return;
      const p = board.positionFormulas;
      boundaries.push(
        { value: r.y, expr: p.y, source: board.id },
        { value: r.y + r.height, expr: `(${p.y}) + (${p.h})`, source: board.id }
      );
    });
  } else {
    boundaries.push(
      { value: 0, expr: "0", source: "parent" },
      { value: cabinetModel.W, expr: "$W", source: "parent" }
    );
    boards.forEach((board) => {
      const r = board.localRect;
      if (fixedCoord < r.y - epsilon || fixedCoord > r.y + r.height + epsilon) return;
      const p = board.positionFormulas;
      boundaries.push(
        { value: r.x, expr: p.x, source: board.id },
        { value: r.x + r.width, expr: `(${p.x}) + (${p.w})`, source: board.id }
      );
    });
  }
  return boundaries;
}

function pickBoundaryHits(boundaries, anchor) {
  const epsilon = 0.1;
  let negative = null;
  let positive = null;
  boundaries.forEach((boundary) => {
    if (boundary.value < anchor - epsilon) {
      if (!negative || boundary.value > negative.value) negative = boundary;
    }
    if (boundary.value > anchor + epsilon) {
      if (!positive || boundary.value < positive.value) positive = boundary;
    }
  });

  if (!negative) {
    boundaries.forEach((boundary) => {
      if (boundary.value <= anchor + epsilon) {
        if (!negative || boundary.value > negative.value) negative = boundary;
      }
    });
  }
  if (!positive) {
    boundaries.forEach((boundary) => {
      if (boundary.value >= anchor - epsilon) {
        if (!positive || boundary.value < positive.value) positive = boundary;
      }
    });
  }
  return { negative, positive };
}

function expandRectByTrace(baseRect, orientation, probePoint) {
  if (orientation === "vertical") {
    const fixedX = clamp(baseRect.x + baseRect.width / 2, 0, cabinetModel.W);
    const boundaries = collectExpansionBoundaries("vertical", fixedX);
    const hits = pickBoundaryHits(boundaries, probePoint.y);
    if (!hits.negative || !hits.positive || hits.positive.value <= hits.negative.value) {
      return { rect: baseRect, traceMeta: null };
    }
    const rect = clampLocalRect({
      x: baseRect.x,
      y: hits.negative.value,
      width: baseRect.width,
      height: Math.max(MIN_DRAW_SIZE_MM, hits.positive.value - hits.negative.value),
    });
    return {
      rect,
      traceMeta: {
        axis: "vertical",
        fixed: fixedX,
        negative: hits.negative,
        positive: hits.positive,
      },
    };
  }

  if (orientation === "horizontal") {
    const fixedY = clamp(baseRect.y + baseRect.height / 2, 0, cabinetModel.H);
    const boundaries = collectExpansionBoundaries("horizontal", fixedY);
    const hits = pickBoundaryHits(boundaries, probePoint.x);
    if (!hits.negative || !hits.positive || hits.positive.value <= hits.negative.value) {
      return { rect: baseRect, traceMeta: null };
    }
    const rect = clampLocalRect({
      x: hits.negative.value,
      y: baseRect.y,
      width: Math.max(MIN_DRAW_SIZE_MM, hits.positive.value - hits.negative.value),
      height: baseRect.height,
    });
    return {
      rect,
      traceMeta: {
        axis: "horizontal",
        fixed: fixedY,
        negative: hits.negative,
        positive: hits.positive,
      },
    };
  }
  return { rect: baseRect, traceMeta: null };
}

function toRelativeFormula(value, refValue, refExpr) {
  const d = value - refValue;
  if (Math.abs(d) < 0.001) return `${refExpr}`;
  if (d > 0) return `(${refExpr}) + ${formatMm(d)}`;
  return `(${refExpr}) - ${formatMm(Math.abs(d))}`;
}

function applyTemplateThickness(localRect, start, current, templateId, orientationOverride) {
  const thickness = getTemplateThickness(templateId);
  const orientation = resolveTemplateOrientation(templateId, start, current, localRect, orientationOverride);
  const out = { ...localRect };
  if (orientation === "vertical") {
    out.width = thickness;
    out.x = current.x >= start.x ? start.x : start.x - thickness;
  }
  if (orientation === "horizontal") {
    out.height = thickness;
    out.y = current.y >= start.y ? start.y : start.y - thickness;
    const sideInsets = getSideInsetMeta();
    const traceTolerance = pxToMm(SNAP_DISTANCE_PX) * 1.5;
    const isTopTrace = Math.min(start.y, current.y) <= traceTolerance;
    const isBottomTrace = Math.max(start.y, current.y) >= cabinetModel.H - traceTolerance;
    const shouldAutoSpan =
      !!sideInsets &&
      ((templateId === "topPanel" && isTopTrace) || (templateId === "bottomPanel" && isBottomTrace));
    if (shouldAutoSpan) {
      out.x = sideInsets.leftInner;
      out.width = sideInsets.rightInner - sideInsets.leftInner;
      out.y = templateId === "bottomPanel" ? cabinetModel.H - thickness : 0;
    }
  }
  return clampLocalRect(out);
}

function buildBoundaryCandidates(axis, probeValue) {
  const boundaries = [];
  const rangeEps = 0.2;
  const pushBoundary = (value, expr, sourceType, sourceId, edge) => {
    if (!Number.isFinite(value)) return;
    boundaries.push({ value, expr, sourceType, sourceId, edge });
  };

  if (axis === "vertical") {
    pushBoundary(0, "0", "parent", "parent", "min");
    pushBoundary(cabinetModel.H, "$H", "parent", "parent", "max");
  } else {
    pushBoundary(0, "0", "parent", "parent", "min");
    pushBoundary(cabinetModel.W, "$W", "parent", "parent", "max");
  }

  boards.forEach((board) => {
    const r = board.localRect;
    const p = board.positionFormulas;
    if (axis === "vertical") {
      if (probeValue < r.x - rangeEps || probeValue > r.x + r.width + rangeEps) return;
      pushBoundary(r.y, p.y, "part", board.id, "min");
      pushBoundary(r.y + r.height, `(${p.y}) + (${p.h})`, "part", board.id, "max");
    } else {
      if (probeValue < r.y - rangeEps || probeValue > r.y + r.height + rangeEps) return;
      pushBoundary(r.x, p.x, "part", board.id, "min");
      pushBoundary(r.x + r.width, `(${p.x}) + (${p.w})`, "part", board.id, "max");
    }
  });

  guideLines.forEach((guide) => {
    if (axis === "vertical" && guide.orientation === "horizontal") {
      pushBoundary(guide.value, guide.expr, "guide", guide.id, "line");
    }
    if (axis === "horizontal" && guide.orientation === "vertical") {
      pushBoundary(guide.value, guide.expr, "guide", guide.id, "line");
    }
  });

  return boundaries.sort((a, b) => a.value - b.value);
}

function raycastBidirectional(boundaries, seedValue) {
  const eps = 0.05;
  const lower = [...boundaries].reverse().find((item) => item.value < seedValue - eps);
  const upper = boundaries.find((item) => item.value > seedValue + eps);

  if (lower && upper && upper.value > lower.value) {
    return { negative: lower, positive: upper };
  }

  const first = boundaries[0];
  const last = boundaries[boundaries.length - 1];
  return { negative: first, positive: last };
}

function buildTraceLengthFormula(traceMeta) {
  if (!traceMeta) return null;
  const negativeExpr = resolveBoundaryExpr(traceMeta.negative, traceMeta.axis);
  const positiveExpr = resolveBoundaryExpr(traceMeta.positive, traceMeta.axis);
  return `(${positiveExpr}) - (${negativeExpr})`;
}

function expandTracePlacement(start, current, templateId, orientationOverride) {
  const orientation = resolveTemplateOrientation(templateId, start, current, null, orientationOverride);
  const raw = normalizeRect(start, current);
  const base = applyTemplateThickness(raw, start, current, templateId, orientation);
  if (orientation !== "vertical" && orientation !== "horizontal") {
    return { localRect: base, orientation, traceMeta: null };
  }

  if (orientation === "vertical") {
    const probeX = clamp(base.x + base.width / 2, 0, cabinetModel.W);
    const seedY = clamp((start.y + current.y) / 2, 0, cabinetModel.H);
    const hits = raycastBidirectional(buildBoundaryCandidates("vertical", probeX), seedY);
    const expanded = clampLocalRect({
      x: base.x,
      y: hits.negative.value,
      width: base.width,
      height: hits.positive.value - hits.negative.value,
    });
    return {
      localRect: expanded,
      orientation,
      traceMeta: { axis: "vertical", probe: probeX, negative: hits.negative, positive: hits.positive },
    };
  }

  const probeY = clamp(base.y + base.height / 2, 0, cabinetModel.H);
  const seedX = clamp((start.x + current.x) / 2, 0, cabinetModel.W);
  const hits = raycastBidirectional(buildBoundaryCandidates("horizontal", probeY), seedX);
  const expanded = clampLocalRect({
    x: hits.negative.value,
    y: base.y,
    width: hits.positive.value - hits.negative.value,
    height: base.height,
  });
  return {
    localRect: expanded,
    orientation,
    traceMeta: { axis: "horizontal", probe: probeY, negative: hits.negative, positive: hits.positive },
  };
}

function resolveBoundaryValue(boundaryRef, axis) {
  if (!boundaryRef) return null;
  if (boundaryRef.sourceType === "parent") {
    if (axis === "vertical") return boundaryRef.edge === "min" ? 0 : cabinetModel.H;
    return boundaryRef.edge === "min" ? 0 : cabinetModel.W;
  }
  if (boundaryRef.sourceType === "guide") {
    const guide = guideLines.find((item) => item.id === boundaryRef.sourceId);
    return guide ? guide.value : null;
  }
  if (boundaryRef.sourceType === "part") {
    const board = boards.find((item) => item.id === boundaryRef.sourceId);
    if (!board) return null;
    if (axis === "vertical") return boundaryRef.edge === "min" ? board.localRect.y : board.localRect.y + board.localRect.height;
    return boundaryRef.edge === "min" ? board.localRect.x : board.localRect.x + board.localRect.width;
  }
  return null;
}

function resolveBoundaryExpr(boundaryRef, axis) {
  if (!boundaryRef) return "0";
  if (boundaryRef.sourceType === "parent") {
    if (axis === "vertical") return boundaryRef.edge === "min" ? "0" : "$H";
    return boundaryRef.edge === "min" ? "0" : "$W";
  }
  if (boundaryRef.sourceType === "guide") {
    const guide = guideLines.find((item) => item.id === boundaryRef.sourceId);
    return guide ? guide.expr : boundaryRef.expr || "0";
  }
  if (boundaryRef.sourceType === "part") {
    const board = boards.find((item) => item.id === boundaryRef.sourceId);
    if (!board) return boundaryRef.expr || "0";
    if (axis === "vertical") {
      return boundaryRef.edge === "min" ? board.positionFormulas.y : `(${board.positionFormulas.y}) + (${board.positionFormulas.h})`;
    }
    return boundaryRef.edge === "min" ? board.positionFormulas.x : `(${board.positionFormulas.x}) + (${board.positionFormulas.w})`;
  }
  return boundaryRef.expr || "0";
}

function traceDependsOnBoard(traceMeta, boardId) {
  if (!traceMeta) return false;
  return (
    (traceMeta.negative?.sourceType === "part" && traceMeta.negative.sourceId === boardId) ||
    (traceMeta.positive?.sourceType === "part" && traceMeta.positive.sourceId === boardId)
  );
}

function recalcTraceLinkedBoard(board) {
  if (!board.traceMeta) return false;
  const before = JSON.stringify(board.localRect);
  const axis = board.traceMeta.axis;
  const negative = resolveBoundaryValue(board.traceMeta.negative, axis);
  const positive = resolveBoundaryValue(board.traceMeta.positive, axis);
  if (negative === null || positive === null || positive <= negative) return false;

  if (axis === "horizontal") {
    board.localRect.x = negative;
    board.localRect.width = positive - negative;
  } else {
    board.localRect.y = negative;
    board.localRect.height = positive - negative;
  }
  board.localRect = clampLocalRect(board.localRect);
  board.finishFormulas = buildFinishFormulas(board.templateId, board.localRect, board.thickness, board.orientation);
  board.positionFormulas = buildPositionFormulas(board.localRect, null, null, board.templateId, board.orientation);

  const lengthFormula = buildTraceLengthFormula(board.traceMeta);
  if (lengthFormula && axis === "horizontal") {
    board.finishFormulas.W = lengthFormula;
    board.positionFormulas.w = lengthFormula;
    board.positionFormulas.x = resolveBoundaryExpr(board.traceMeta.negative, axis);
  }
  if (lengthFormula && axis === "vertical") {
    board.finishFormulas.H = lengthFormula;
    board.positionFormulas.h = lengthFormula;
    board.positionFormulas.y = resolveBoundaryExpr(board.traceMeta.negative, axis);
  }
  applyPlacementMeta(board);
  applyLocalRectToNode(board, board.localRect);
  return before !== JSON.stringify(board.localRect);
}

function propagateLinkedBoardsFrom(changedBoardId) {
  const queue = [changedBoardId];
  const expanded = new Set();
  while (queue.length > 0) {
    const sourceId = queue.shift();
    boards.forEach((board) => {
      if (board.id === sourceId) return;
      if (!traceDependsOnBoard(board.traceMeta, sourceId)) return;
      const changed = recalcTraceLinkedBoard(board);
      if (changed && !expanded.has(board.id)) {
        expanded.add(board.id);
        queue.push(board.id);
      }
    });
  }
}

function buildTracePreviewPoints(traceMeta) {
  if (!traceMeta) return [];
  if (traceMeta.axis === "vertical") {
    const p1 = localToStagePoint({ x: traceMeta.probe, y: traceMeta.negative.value });
    const p2 = localToStagePoint({ x: traceMeta.probe, y: traceMeta.positive.value });
    return [p1.x, p1.y, p2.x, p2.y];
  }
  const p1 = localToStagePoint({ x: traceMeta.negative.value, y: traceMeta.probe });
  const p2 = localToStagePoint({ x: traceMeta.positive.value, y: traceMeta.probe });
  return [p1.x, p1.y, p2.x, p2.y];
}

function getSideInsetMeta() {
  const sideBoards = boards.filter((board) => board.role === "side-panel");
  if (sideBoards.length < 2) return null;

  const center = cabinetModel.W / 2;
  const leftBoards = sideBoards.filter(
    (board) => board.placementSide === "left" || board.localRect.x + board.localRect.width / 2 < center
  );
  const rightBoards = sideBoards.filter(
    (board) => board.placementSide === "right" || board.localRect.x + board.localRect.width / 2 >= center
  );
  if (leftBoards.length === 0 || rightBoards.length === 0) return null;

  const leftInner = Math.max(...leftBoards.map((board) => board.localRect.x + board.localRect.width));
  const rightInner = Math.min(...rightBoards.map((board) => board.localRect.x));
  if (!Number.isFinite(leftInner) || !Number.isFinite(rightInner) || rightInner <= leftInner) return null;

  return {
    leftInner,
    rightInner,
    leftInset: leftInner,
    rightInset: cabinetModel.W - rightInner,
  };
}

function detectAutoSpanMeta(templateId, localRect, thickness) {
  if (templateId !== "topPanel" && templateId !== "bottomPanel") return null;
  const sideInsets = getSideInsetMeta();
  if (!sideInsets) return null;
  const expectedWidth = sideInsets.rightInner - sideInsets.leftInner;
  const tolerance = 0.6;
  const expectedY = templateId === "bottomPanel" ? cabinetModel.H - thickness : 0;
  if (Math.abs(localRect.x - sideInsets.leftInner) > tolerance) return null;
  if (Math.abs(localRect.width - expectedWidth) > tolerance) return null;
  if (Math.abs(localRect.y - expectedY) > tolerance) return null;
  return sideInsets;
}

function derivePlacementMeta(orientation, localRect) {
  if (orientation === "vertical") {
    const centerX = localRect.x + localRect.width / 2;
    const side = centerX >= cabinetModel.W / 2 ? "right" : "left";
    return {
      placementSide: side,
      isMirrored: side === "right",
    };
  }
  if (orientation === "horizontal") {
    const centerY = localRect.y + localRect.height / 2;
    const side = centerY >= cabinetModel.H / 2 ? "bottom" : "top";
    return {
      placementSide: side,
      isMirrored: side === "bottom",
    };
  }
  return {
    placementSide: "center",
    isMirrored: false,
  };
}

function applyPlacementMeta(board) {
  const meta = derivePlacementMeta(board.orientation, board.localRect);
  board.placementSide = meta.placementSide;
  board.isMirrored = meta.isMirrored;
}

function inferFinishByFrontViewMode(template, orientation, localRect, thickness) {
  if (template.frontViewMode === "edge") {
    if (orientation === "vertical") {
      return { W: `${thickness}`, H: `${formatMm(localRect.height)}`, D: "$D" };
    }
    if (orientation === "horizontal") {
      return { W: `${formatMm(localRect.width)}`, H: `${thickness}`, D: "$D" };
    }
    return { W: `${thickness}`, H: `${formatMm(localRect.height)}`, D: "$D" };
  }
  return { W: `${formatMm(localRect.width)}`, H: `${formatMm(localRect.height)}`, D: `${thickness}` };
}

function applyLocalRectToNode(board, rect) {
  const stageRect = localRectToStageRect(rect);
  board.node.position({ x: stageRect.x, y: stageRect.y });
  board.node.size({ width: stageRect.width, height: stageRect.height });
}

function createBoardNode(board) {
  const stageRect = localRectToStageRect(board.localRect);
  const colors = {
    vertical: { fill: "rgba(37,99,235,0.2)", stroke: "#1d4ed8" },
    horizontal: { fill: "rgba(22,163,74,0.2)", stroke: "#15803d" },
    sheet: { fill: "rgba(234,88,12,0.2)", stroke: "#c2410c" },
  };
  const color = colors[board.orientation] || colors.sheet;
  const template = getTemplate(board.templateId);
  const isFace = template.frontViewMode === "face";
  const node = new Konva.Rect({
    x: stageRect.x,
    y: stageRect.y,
    width: stageRect.width,
    height: stageRect.height,
    stroke: isFace ? "#7c2d12" : color.stroke,
    fill: isFace ? "rgba(217,119,6,0.2)" : color.fill,
    strokeWidth: isFace ? 1.5 : 2,
    dash: isFace ? [4, 3] : [],
    cornerRadius: 3,
    draggable: true,
    name: "board",
  });

  node.on("click tap", () => selectBoard(node));
  node.on("dragstart", () => {
    lastHudOperation = "move";
    refreshHud();
  });
  node.on("dragmove", () => {
    const previousRect = { ...board.localRect };
    const current = stageToLocalPoint({ x: node.x(), y: node.y() });
    const snapped = snapLocalPoint(current);
    const nextRect = clampLocalRect({
      ...board.localRect,
      x: snapped.x,
      y: snapped.y,
    });
    if (overlapsAnyOtherBoard(nextRect, board.id)) {
      applyLocalRectToNode(board, previousRect);
      return;
    }
    board.localRect = nextRect;
    applyPlacementMeta(board);
    board.positionFormulas.x = snapped.snappedX ? toRelativeFormula(nextRect.x, snapped.refXValue, snapped.refXExpr) : formatMm(nextRect.x);
    board.positionFormulas.y = snapped.snappedY ? toRelativeFormula(nextRect.y, snapped.refYValue, snapped.refYExpr) : formatMm(nextRect.y);
    applyLocalRectToNode(board, nextRect);
    propagateLinkedBoardsFrom(board.id);
    refreshHud();
    updatePartsList();
    layer.batchDraw();
  });
  node.on("transformstart", () => {
    lastHudOperation = "resize";
    refreshHud();
  });
  node.on("transformend", () => {
    const previousRect = { ...board.localRect };
    node.width(node.width() * node.scaleX());
    node.height(node.height() * node.scaleY());
    node.scale({ x: 1, y: 1 });
    const local = stageToLocalPoint({ x: node.x(), y: node.y() });
    let nextRect = {
      x: local.x,
      y: local.y,
      width: pxToMm(node.width()),
      height: pxToMm(node.height()),
    };
    nextRect = applyTemplateThickness(nextRect, nextRect, nextRect, board.templateId, board.orientation);
    if (overlapsAnyOtherBoard(nextRect, board.id)) {
      board.localRect = previousRect;
      applyLocalRectToNode(board, previousRect);
      layer.batchDraw();
      return;
    }
    board.localRect = nextRect;
    applyPlacementMeta(board);
    board.finishFormulas = buildFinishFormulas(board.templateId, nextRect, board.thickness, board.orientation);
    board.positionFormulas = buildPositionFormulas(nextRect, null, null, board.templateId, board.orientation);
    applyLocalRectToNode(board, nextRect);
    propagateLinkedBoardsFrom(board.id);
    refreshHud();
    updatePartsList();
    layer.batchDraw();
  });

  return node;
}

function getConstraintLabel(board) {
  if (!board) return "拘束なし";
  if (board.orientation === "vertical") return "拘束: 厚み方向固定（縦材）/ 高さのみ変更可";
  if (board.orientation === "horizontal") return "拘束: 厚み方向固定（横材）/ 幅のみ変更可";
  return "拘束: 面材（両方向変更可）";
}

function updateConstraintOverlay(board) {
  if (!constraintOverlay) {
    constraintOverlay = new Konva.Line({
      stroke: "#f59e0b",
      strokeWidth: 2,
      dash: [5, 4],
      listening: false,
      visible: false,
    });
    layer.add(constraintOverlay);
  }
  if (!board) {
    constraintOverlay.visible(false);
    return;
  }
  const rect = board.localRect;
  if (board.orientation === "vertical") {
    const cx = rect.x + rect.width / 2;
    const p1 = localToStagePoint({ x: cx, y: rect.y });
    const p2 = localToStagePoint({ x: cx, y: rect.y + rect.height });
    constraintOverlay.points([p1.x, p1.y, p2.x, p2.y]);
    constraintOverlay.visible(true);
    return;
  }
  if (board.orientation === "horizontal") {
    const cy = rect.y + rect.height / 2;
    const p1 = localToStagePoint({ x: rect.x, y: cy });
    const p2 = localToStagePoint({ x: rect.x + rect.width, y: cy });
    constraintOverlay.points([p1.x, p1.y, p2.x, p2.y]);
    constraintOverlay.visible(true);
    return;
  }
  constraintOverlay.visible(false);
}

function buildFinishFormulas(templateId, localRect, thickness, orientationOverride) {
  const template = getTemplate(templateId);
  const orientation = resolveTemplateOrientation(templateId, null, null, localRect, orientationOverride);
  const base = inferFinishByFrontViewMode(template, orientation, localRect, thickness);
  const autoSpanMeta = detectAutoSpanMeta(templateId, localRect, thickness);
  if (autoSpanMeta && orientation === "horizontal") {
    base.W = `$W - ${formatMm(autoSpanMeta.leftInset)} - ${formatMm(autoSpanMeta.rightInset)}`;
    base.H = `${thickness}`;
  }
  return base;
}

function buildPositionFormulas(localRect, start, end, templateId, orientationOverride) {
  const orientation = resolveTemplateOrientation(templateId, start, end, localRect, orientationOverride);
  const thickness = getTemplateThickness(templateId);
  const formulas = {
    x: start && start.snappedX ? toRelativeFormula(localRect.x, start.refXValue, start.refXExpr) : formatMm(localRect.x),
    y: start && start.snappedY ? toRelativeFormula(localRect.y, start.refYValue, start.refYExpr) : formatMm(localRect.y),
    w: formatMm(localRect.width),
    h: formatMm(localRect.height),
  };
  if (start && end && start.snappedX && end.snappedX && orientation !== "vertical") {
    formulas.w = `(${end.refXExpr}) - (${start.refXExpr})`;
  }
  if (start && end && start.snappedY && end.snappedY && orientation !== "horizontal") {
    formulas.h = `(${end.refYExpr}) - (${start.refYExpr})`;
  }
  const autoSpanMeta = detectAutoSpanMeta(templateId, localRect, thickness);
  if (autoSpanMeta && orientation === "horizontal") {
    formulas.x = formatMm(autoSpanMeta.leftInset);
    formulas.w = `$W - ${formatMm(autoSpanMeta.leftInset)} - ${formatMm(autoSpanMeta.rightInset)}`;
    formulas.y = templateId === "bottomPanel" ? `$H - ${thickness}` : "0";
    formulas.h = `${thickness}`;
  }
  return formulas;
}

function createBoardFromDraw(localRect, start, end, orientationOverride, traceMetaOverride) {
  const templateId = templateSelectEl.value;
  const template = getTemplate(templateId);
  const thickness = getTemplateThickness(templateId);
  const orientation = resolveTemplateOrientation(templateId, start, end, localRect, orientationOverride);
  const traceLengthFormula = buildTraceLengthFormula(traceMetaOverride);
  const finishFormulas = buildFinishFormulas(templateId, localRect, thickness, orientation);
  const positionFormulas = buildPositionFormulas(localRect, start, end, templateId, orientation);
  if (traceLengthFormula && orientation === "horizontal") {
    finishFormulas.W = traceLengthFormula;
    positionFormulas.w = traceLengthFormula;
    positionFormulas.x = traceMetaOverride.negative.expr;
  }
  if (traceLengthFormula && orientation === "vertical") {
    finishFormulas.H = traceLengthFormula;
    positionFormulas.h = traceLengthFormula;
    positionFormulas.y = traceMetaOverride.negative.expr;
  }
  const board = {
    id: `part-${boardCounter}`,
    kind: "part",
    parentId: "cabinet-root",
    templateId,
    orientation,
    name: template.label,
    role: template.role,
    frontViewMode: template.frontViewMode,
    placementSide: "center",
    isMirrored: false,
    matId: template.matId,
    thickness,
    drawingNo: `${DRAWING_NO_PREFIX}${String(boardCounter).padStart(4, "0")}`,
    marginFormulas: { W: `${DEFAULT_MARGIN_MM}`, H: `${DEFAULT_MARGIN_MM}`, D: `${DEFAULT_MARGIN_MM}` },
    localRect,
    traceMeta: traceMetaOverride || null,
    finishFormulas,
    positionFormulas,
    node: null,
  };
  applyPlacementMeta(board);
  board.node = createBoardNode(board);
  boardCounter += 1;
  return board;
}

function getBoardByNode(node) {
  return boards.find((b) => b.node === node) || null;
}

function selectBoard(node) {
  selectedNode = node;
  const board = getBoardByNode(node);
  if (board?.orientation === "vertical") {
    tr.enabledAnchors(["top-center", "bottom-center"]);
  } else if (board?.orientation === "horizontal") {
    tr.enabledAnchors(["middle-left", "middle-right"]);
  } else {
    tr.enabledAnchors(["top-left", "top-right", "bottom-left", "bottom-right"]);
  }
  lastHudOperation = "move";
  tr.nodes([node]);
  updateConstraintOverlay(board);
  refreshHud();
  layer.batchDraw();
}

function updateSummaryList() {
  if (boards.length === 0) {
    summaryListEl.innerHTML = `<div class="empty">部材を配置すると枚数が集計されます。</div>`;
    return;
  }
  const map = {};
  boards.forEach((board) => {
    const key = `${board.name} / ${board.matId} / t${board.thickness}`;
    map[key] = (map[key] || 0) + 1;
  });
  summaryListEl.innerHTML = Object.entries(map)
    .map(
      ([label, count]) =>
        `<article class="part-card"><div class="row"><span>${label}</span><strong>${count} 枚</strong></div></article>`
    )
    .join("");
}

function updatePartsList() {
  if (boards.length === 0) {
    partsListEl.innerHTML = `<div class="empty">まだ部材がありません。キャビネット枠を作成後、ドラッグで配置してください。</div>`;
    updateSummaryList();
    return;
  }
  partsListEl.innerHTML = boards
    .map((board) => {
      const dims = resolvePartDimensions(board);
      return `
        <article class="part-card">
          <h3 class="part-title">${board.name} / ${board.drawingNo}</h3>
          <div class="row"><span>role</span><strong>${board.role}</strong></div>
          <div class="row"><span>正面表示</span><strong>${board.frontViewMode === "face" ? "面表示（例外）" : "厚み表示（標準）"}</strong></div>
          <div class="row"><span>配置側</span><strong>${board.placementSide}</strong></div>
          <div class="row"><span>反転</span><strong>${board.isMirrored ? "右/下で反転" : "左/上で標準"}</strong></div>
          <div class="row"><span>素材</span><strong>${board.matId} (t${board.thickness})</strong></div>
          <div class="row"><span>仕上がり寸法</span><strong>${dimsLabel(dims.finish.W ?? 0, dims.finish.H ?? 0)}</strong></div>
          <div class="row"><span>発注寸法</span><strong>${dimsLabel(dims.order.W ?? 0, dims.order.H ?? 0)}</strong></div>
          <div class="row"><span>座標式</span><strong>x:${board.positionFormulas.x} / y:${board.positionFormulas.y}</strong></div>
        </article>
      `;
    })
    .join("");
  updateSummaryList();
}

function refreshHud() {
  if (!selectedNode) {
    hudStateEl.innerHTML = "<br />選択なし<br />拘束: -";
    return;
  }
  const board = getBoardByNode(selectedNode);
  if (!board) return;
  hudStateEl.innerHTML = `<br />選択中: ${board.name} / ${board.drawingNo}<br />モード: <code>${lastHudOperation}</code><br />入力バッファ: <code>${
    keyBuffer.text || "(empty)"
  }</code><br />${getConstraintLabel(board)}`;
}

function beginDraw(event) {
  if (getCurrentMode() === "guide") {
    beginGuideDraw();
    return;
  }
  if (event.target && event.target !== stage && event.target !== cabinetFrameNode) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const local = stageToLocalPoint(pointer);
  if (local.x < 0 || local.y < 0 || local.x > cabinetModel.W || local.y > cabinetModel.H) return;

  isDrawing = true;
  startSnap = snapLocalPoint(local);
  currentLocalRect = null;

  if (!draftRect) {
    draftRect = new Konva.Rect({
      stroke: "#2563eb",
      strokeWidth: 2,
      dash: [6, 5],
      fill: "rgba(37,99,235,0.08)",
      listening: false,
    });
    draftText = new Konva.Text({
      fontSize: 13,
      fill: "#1d4ed8",
      listening: false,
      fontStyle: "bold",
    });
    layer.add(draftRect);
    layer.add(draftText);
  }
}

function continueDraw() {
  if (getCurrentMode() === "guide") {
    continueGuideDraw();
    return;
  }
  if (!isDrawing || !startSnap) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const local = stageToLocalPoint(pointer);
  const clamped = { x: clamp(local.x, 0, cabinetModel.W), y: clamp(local.y, 0, cabinetModel.H) };
  const snapped = snapLocalPoint(clamped);
  const expanded = expandTracePlacement(startSnap, snapped, templateSelectEl.value);
  currentLocalRect = expanded.localRect;
  currentTraceMeta = expanded.traceMeta;
  const stageRect = localRectToStageRect(currentLocalRect);

  draftRect.position({ x: stageRect.x, y: stageRect.y });
  draftRect.size({ width: stageRect.width, height: stageRect.height });
  draftText.position({ x: stageRect.x + 2, y: stageRect.y - 18 });
  draftText.text(`W ${Math.round(currentLocalRect.width)} / H ${Math.round(currentLocalRect.height)} mm`);
  if (!draftRayLine) {
    draftRayLine = new Konva.Line({
      stroke: "#0ea5e9",
      strokeWidth: 1.5,
      dash: [3, 3],
      listening: false,
    });
    layer.add(draftRayLine);
  }
  draftRayLine.points(buildTracePreviewPoints(currentTraceMeta));
  layer.batchDraw();
}

function endDraw() {
  if (getCurrentMode() === "guide") {
    endGuideDraw();
    return;
  }
  if (!isDrawing) return;
  isDrawing = false;
  if (!currentLocalRect || currentLocalRect.width < MIN_DRAW_SIZE_MM || currentLocalRect.height < MIN_DRAW_SIZE_MM) {
    if (draftRect) {
      draftRect.size({ width: 0, height: 0 });
      draftText.text("");
    }
    if (draftRayLine) draftRayLine.points([]);
    currentTraceMeta = null;
    layer.batchDraw();
    return;
  }

  const endSnap = snapLocalPoint({
    x: currentLocalRect.x + currentLocalRect.width,
    y: currentLocalRect.y + currentLocalRect.height,
  });
  const finalOrientation = currentTraceMeta?.axis === "vertical" ? "vertical" : currentTraceMeta?.axis === "horizontal" ? "horizontal" : null;
  const board = createBoardFromDraw(currentLocalRect, startSnap, endSnap, finalOrientation, currentTraceMeta);
  if (overlapsAnyOtherBoard(board.localRect, board.id)) {
    if (draftRect) {
      draftRect.size({ width: 0, height: 0 });
      draftText.text("");
    }
    if (draftRayLine) draftRayLine.points([]);
    currentTraceMeta = null;
    layer.batchDraw();
    return;
  }
  boards.push(board);
  layer.add(board.node);
  selectBoard(board.node);
  updatePartsList();

  draftRect.size({ width: 0, height: 0 });
  draftText.text("");
  if (draftRayLine) draftRayLine.points([]);
  currentTraceMeta = null;
  layer.batchDraw();
}

function parseRelativeInput(text) {
  const trimmed = text.trim();
  if (!/^[+-]\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

function applyRelativeDelta(deltaMm) {
  if (!selectedNode) return;
  const board = getBoardByNode(selectedNode);
  if (!board) return;

  const previousRect = { ...board.localRect };
  const next = { ...board.localRect };
  if (lastHudOperation === "resize") {
    if (board.orientation === "vertical") next.height += deltaMm;
    else if (board.orientation === "horizontal") next.width += deltaMm;
    else {
      next.width += deltaMm;
      next.height += deltaMm;
    }
    const thickened = applyTemplateThickness(next, next, next, board.templateId, board.orientation);
    board.localRect = thickened;
    applyPlacementMeta(board);
    board.finishFormulas = buildFinishFormulas(board.templateId, thickened, board.thickness, board.orientation);
    board.positionFormulas = buildPositionFormulas(thickened, null, null, board.templateId, board.orientation);
  } else {
    next.x += deltaMm;
    next.y += deltaMm;
    board.localRect = clampLocalRect(next);
    applyPlacementMeta(board);
    board.positionFormulas.x = formatMm(board.localRect.x);
    board.positionFormulas.y = formatMm(board.localRect.y);
  }

  if (overlapsAnyOtherBoard(board.localRect, board.id)) {
    board.localRect = previousRect;
    applyLocalRectToNode(board, previousRect);
    layer.batchDraw();
    return;
  }

  applyLocalRectToNode(board, board.localRect);
  propagateLinkedBoardsFrom(board.id);
  updatePartsList();
  refreshHud();
  layer.batchDraw();
}

function handleKeyboardInput(event) {
  if (event.key === "Escape") {
    keyBuffer.text = "";
    refreshHud();
    return;
  }
  if (event.key === "Backspace") {
    keyBuffer.text = keyBuffer.text.slice(0, -1);
    refreshHud();
    return;
  }
  if (event.key === "Enter") {
    const delta = parseRelativeInput(keyBuffer.text);
    if (delta !== null) applyRelativeDelta(delta);
    keyBuffer.text = "";
    refreshHud();
    return;
  }
  if (/^[0-9.+-]$/.test(event.key)) {
    keyBuffer.text += event.key;
    refreshHud();
  }
}

function initStage() {
  stage = new Konva.Stage({
    container: "stage-container",
    width: stageContainer.clientWidth,
    height: stageContainer.clientHeight,
  });
  layer = new Konva.Layer();
  stage.add(layer);

  tr = new Konva.Transformer({
    rotateEnabled: false,
    keepRatio: false,
    enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
    borderStroke: "#2563eb",
    anchorStroke: "#2563eb",
    anchorFill: "#ffffff",
    anchorSize: 8,
  });
  layer.add(tr);

  stage.on("mousedown touchstart", beginDraw);
  stage.on("mousemove touchmove", continueDraw);
  stage.on("mouseup touchend", endDraw);
  stage.on("click tap", (event) => {
    if (event.target === stage || event.target === cabinetFrameNode) {
      selectedNode = null;
      tr.enabledAnchors(["top-left", "top-right", "bottom-left", "bottom-right"]);
      tr.nodes([]);
      updateConstraintOverlay(null);
      refreshHud();
      layer.batchDraw();
    }
  });

  applyCabinetBtn.addEventListener("click", () => drawCabinetFrame(true));
  modeSelectEl.addEventListener("change", () => {
    isDrawing = false;
    guideDragStart = null;
    if (guidePreviewNode) {
      guidePreviewNode.points([]);
    }
    selectedNode = null;
    tr.enabledAnchors(["top-left", "top-right", "bottom-left", "bottom-right"]);
    tr.nodes([]);
    updateConstraintOverlay(null);
    refreshHud();
    layer.batchDraw();
  });
  window.addEventListener("keydown", handleKeyboardInput);
  window.addEventListener("resize", () => {
    stage.width(stageContainer.clientWidth);
    stage.height(stageContainer.clientHeight);
    drawCabinetFrame(false);
  });

  drawCabinetFrame(true);
  refreshHud();
}

initStage();
