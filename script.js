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
    label: "棚板",
    role: "shelf-panel",
    matId: "ply20Laminate",
    orientation: "horizontal",
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

let stage;
let layer;
let tr;
let cabinetFrameNode = null;
let cabinetLabelNode = null;
let isDrawing = false;
let startSnap = null;
let currentLocalRect = null;
let selectedNode = null;
let draftRect = null;
let draftText = null;
let lastHudOperation = "move";
const keyBuffer = { text: "" };
const boards = [];
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

function toRelativeFormula(value, refValue, refExpr) {
  const d = value - refValue;
  if (Math.abs(d) < 0.001) return `${refExpr}`;
  if (d > 0) return `(${refExpr}) + ${formatMm(d)}`;
  return `(${refExpr}) - ${formatMm(Math.abs(d))}`;
}

function applyTemplateThickness(localRect, start, current, templateId) {
  const template = getTemplate(templateId);
  const thickness = getTemplateThickness(templateId);
  const out = { ...localRect };
  if (template.orientation === "vertical") {
    out.width = thickness;
    out.x = current.x >= start.x ? start.x : start.x - thickness;
  }
  if (template.orientation === "horizontal") {
    out.height = thickness;
    out.y = current.y >= start.y ? start.y : start.y - thickness;
  }
  return clampLocalRect(out);
}

function inferFinishByFrontViewMode(template, localRect, thickness) {
  if (template.frontViewMode === "edge") {
    if (template.orientation === "vertical") {
      return { W: `${thickness}`, H: `${formatMm(localRect.height)}`, D: "$D" };
    }
    if (template.orientation === "horizontal") {
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
    const current = stageToLocalPoint({ x: node.x(), y: node.y() });
    const snapped = snapLocalPoint(current);
    const nextRect = clampLocalRect({
      ...board.localRect,
      x: snapped.x,
      y: snapped.y,
    });
    board.localRect = nextRect;
    board.positionFormulas.x = snapped.snappedX ? toRelativeFormula(nextRect.x, snapped.refXValue, snapped.refXExpr) : formatMm(nextRect.x);
    board.positionFormulas.y = snapped.snappedY ? toRelativeFormula(nextRect.y, snapped.refYValue, snapped.refYExpr) : formatMm(nextRect.y);
    applyLocalRectToNode(board, nextRect);
    refreshHud();
    updatePartsList();
    layer.batchDraw();
  });
  node.on("transformstart", () => {
    lastHudOperation = "resize";
    refreshHud();
  });
  node.on("transformend", () => {
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
    nextRect = applyTemplateThickness(nextRect, nextRect, nextRect, board.templateId);
    board.localRect = nextRect;
    board.finishFormulas = buildFinishFormulas(board.templateId, nextRect, board.thickness);
    board.positionFormulas = buildPositionFormulas(nextRect, null, null, board.templateId);
    applyLocalRectToNode(board, nextRect);
    refreshHud();
    updatePartsList();
    layer.batchDraw();
  });

  return node;
}

function buildFinishFormulas(templateId, localRect, thickness) {
  const template = getTemplate(templateId);
  return inferFinishByFrontViewMode(template, localRect, thickness);
}

function buildPositionFormulas(localRect, start, end, templateId) {
  const template = getTemplate(templateId);
  const formulas = {
    x: start && start.snappedX ? toRelativeFormula(localRect.x, start.refXValue, start.refXExpr) : formatMm(localRect.x),
    y: start && start.snappedY ? toRelativeFormula(localRect.y, start.refYValue, start.refYExpr) : formatMm(localRect.y),
    w: formatMm(localRect.width),
    h: formatMm(localRect.height),
  };
  if (start && end && start.snappedX && end.snappedX && template.orientation !== "vertical") {
    formulas.w = `(${end.refXExpr}) - (${start.refXExpr})`;
  }
  if (start && end && start.snappedY && end.snappedY && template.orientation !== "horizontal") {
    formulas.h = `(${end.refYExpr}) - (${start.refYExpr})`;
  }
  return formulas;
}

function createBoardFromDraw(localRect, start, end) {
  const templateId = templateSelectEl.value;
  const template = getTemplate(templateId);
  const thickness = getTemplateThickness(templateId);
  const board = {
    id: `part-${boardCounter}`,
    kind: "part",
    parentId: "cabinet-root",
    templateId,
    orientation: template.orientation,
    name: template.label,
    role: template.role,
    frontViewMode: template.frontViewMode,
    matId: template.matId,
    thickness,
    drawingNo: `${DRAWING_NO_PREFIX}${String(boardCounter).padStart(4, "0")}`,
    marginFormulas: { W: `${DEFAULT_MARGIN_MM}`, H: `${DEFAULT_MARGIN_MM}`, D: `${DEFAULT_MARGIN_MM}` },
    localRect,
    finishFormulas: buildFinishFormulas(templateId, localRect, thickness),
    positionFormulas: buildPositionFormulas(localRect, start, end, templateId),
    node: null,
  };
  board.node = createBoardNode(board);
  boardCounter += 1;
  return board;
}

function getBoardByNode(node) {
  return boards.find((b) => b.node === node) || null;
}

function selectBoard(node) {
  selectedNode = node;
  lastHudOperation = "move";
  tr.nodes([node]);
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
    hudStateEl.innerHTML = "<br />選択なし";
    return;
  }
  const board = getBoardByNode(selectedNode);
  if (!board) return;
  hudStateEl.innerHTML = `<br />選択中: ${board.name} / ${board.drawingNo}<br />モード: <code>${lastHudOperation}</code><br />入力バッファ: <code>${
    keyBuffer.text || "(empty)"
  }</code>`;
}

function beginDraw(event) {
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
  if (!isDrawing || !startSnap) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const local = stageToLocalPoint(pointer);
  const clamped = { x: clamp(local.x, 0, cabinetModel.W), y: clamp(local.y, 0, cabinetModel.H) };
  const snapped = snapLocalPoint(clamped);
  const raw = normalizeRect(startSnap, snapped);
  currentLocalRect = applyTemplateThickness(raw, startSnap, snapped, templateSelectEl.value);
  const stageRect = localRectToStageRect(currentLocalRect);

  draftRect.position({ x: stageRect.x, y: stageRect.y });
  draftRect.size({ width: stageRect.width, height: stageRect.height });
  draftText.position({ x: stageRect.x + 2, y: stageRect.y - 18 });
  draftText.text(`W ${Math.round(currentLocalRect.width)} / H ${Math.round(currentLocalRect.height)} mm`);
  layer.batchDraw();
}

function endDraw() {
  if (!isDrawing) return;
  isDrawing = false;
  if (!currentLocalRect || currentLocalRect.width < MIN_DRAW_SIZE_MM || currentLocalRect.height < MIN_DRAW_SIZE_MM) {
    if (draftRect) {
      draftRect.size({ width: 0, height: 0 });
      draftText.text("");
    }
    layer.batchDraw();
    return;
  }

  const endSnap = snapLocalPoint({
    x: currentLocalRect.x + currentLocalRect.width,
    y: currentLocalRect.y + currentLocalRect.height,
  });
  const board = createBoardFromDraw(currentLocalRect, startSnap, endSnap);
  boards.push(board);
  layer.add(board.node);
  selectBoard(board.node);
  updatePartsList();

  draftRect.size({ width: 0, height: 0 });
  draftText.text("");
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

  const next = { ...board.localRect };
  if (lastHudOperation === "resize") {
    if (board.orientation === "vertical") next.height += deltaMm;
    else if (board.orientation === "horizontal") next.width += deltaMm;
    else {
      next.width += deltaMm;
      next.height += deltaMm;
    }
    const thickened = applyTemplateThickness(next, next, next, board.templateId);
    board.localRect = thickened;
    board.finishFormulas = buildFinishFormulas(board.templateId, thickened, board.thickness);
    board.positionFormulas = buildPositionFormulas(thickened, null, null, board.templateId);
  } else {
    next.x += deltaMm;
    next.y += deltaMm;
    board.localRect = clampLocalRect(next);
    board.positionFormulas.x = formatMm(board.localRect.x);
    board.positionFormulas.y = formatMm(board.localRect.y);
  }

  applyLocalRectToNode(board, board.localRect);
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
      tr.nodes([]);
      refreshHud();
      layer.batchDraw();
    }
  });

  applyCabinetBtn.addEventListener("click", () => drawCabinetFrame(true));
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
