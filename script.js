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
const maxStockLengthEl = document.getElementById("max-stock-length");
const clearanceXEl = document.getElementById("clearance-x");
const clearanceYEl = document.getElementById("clearance-y");
const fabricationPolicyStateEl = document.getElementById("fabrication-policy-state");
const sectionAxisEl = document.getElementById("section-axis-select");
const sectionPlaneMmEl = document.getElementById("section-plane-mm");
const sectionDeltaMmEl = document.getElementById("section-delta-mm");
const sectionSideModeEl = document.getElementById("section-side-mode");
const sectionUniformToggleEl = document.getElementById("section-uniform-toggle");
const applySectionStretchBtn = document.getElementById("apply-section-stretch-btn");
const sectionHandleLeftBtn = document.getElementById("section-handle-left");
const sectionHandleCenterXBtn = document.getElementById("section-handle-center-x");
const sectionHandleRightBtn = document.getElementById("section-handle-right");
const sectionHandleTopBtn = document.getElementById("section-handle-top");
const sectionHandleMiddleYBtn = document.getElementById("section-handle-middle-y");
const sectionHandleBottomBtn = document.getElementById("section-handle-bottom");

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
let scalePlaneOverlay = null;
let lastHudOperation = "move";
const keyBuffer = { text: "" };
const boards = [];
const guideLines = [];
const junctionMarkers = [];
const halfLapPairKeys = new Set();
let guideCounter = 1;
let boardCounter = 1;
const fabricationPolicy = {
  mergePolicy: "never",
  maxStockLength: 2400,
  defaultClearanceX: 0,
  defaultClearanceY: 0,
};

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

function getMaterialThicknessFormula(matId, fallback) {
  const raw = MATERIALS[matId]?.thicknessFormula;
  if (!raw) return `${fallback}`;
  return normalizeDecimalComma(raw);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  const eps = 0.001;
  return a.x + eps < b.x + b.width && a.x + a.width > b.x + eps && a.y + eps < b.y + b.height && a.y + a.height > b.y + eps;
}

function getBoardPadding(board) {
  return {
    x: Math.max(0, Number(board?.clearanceX ?? fabricationPolicy.defaultClearanceX) || 0),
    y: Math.max(0, Number(board?.clearanceY ?? fabricationPolicy.defaultClearanceY) || 0),
  };
}

function expandRectByPadding(rect, padX, padY) {
  return {
    x: rect.x - padX,
    y: rect.y - padY,
    width: rect.width + padX * 2,
    height: rect.height + padY * 2,
  };
}

function getBoardCollisionRect(board, rectOverride) {
  const pad = getBoardPadding(board);
  return expandRectByPadding(rectOverride || board.localRect, pad.x, pad.y);
}

function overlapsAnyOtherBoard(candidateRect, currentBoardId, candidatePadding) {
  const padX = Math.max(0, Number(candidatePadding?.x ?? fabricationPolicy.defaultClearanceX) || 0);
  const padY = Math.max(0, Number(candidatePadding?.y ?? fabricationPolicy.defaultClearanceY) || 0);
  const candidateExpanded = expandRectByPadding(candidateRect, padX, padY);
  return boards.some((item) => item.id !== currentBoardId && rectsOverlap(candidateExpanded, getBoardCollisionRect(item)));
}

function applyMoveAxisConstraint(nextRect, baseRect, orientation) {
  if (orientation === "vertical") {
    return { ...nextRect, y: baseRect.y };
  }
  if (orientation === "horizontal") {
    return { ...nextRect, x: baseRect.x };
  }
  return nextRect;
}

function isFiniteRect(rect) {
  return (
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function getObstacleRectWithClearance(board, boardIndex) {
  if (!board || boardIndex === undefined || boardIndex === null) return null;
  const rect = board.localRect;
  if (!isFiniteRect(rect)) return null;
  const pad = getBoardPadding(board);

  return {
    x: clamp(rect.x - pad.x, 0, cabinetModel.W),
    y: clamp(rect.y - pad.y, 0, cabinetModel.H),
    width: clamp(rect.width + pad.x * 2, MIN_DRAW_SIZE_MM, cabinetModel.W),
    height: clamp(rect.height + pad.y * 2, MIN_DRAW_SIZE_MM, cabinetModel.H),
    boardId: board.id,
    boardIndex,
  };
}

function buildRayBoundariesForBoard(axis, probeValue, boardIndexLimit, excludeBoardId) {
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

  for (let i = 0; i < boardIndexLimit; i += 1) {
    const board = boards[i];
    if (!board || board.id === excludeBoardId) continue;
    const obstacle = getObstacleRectWithClearance(board, i);
    if (!obstacle) continue;
    if (axis === "vertical") {
      if (probeValue < obstacle.x - rangeEps || probeValue > obstacle.x + obstacle.width + rangeEps) continue;
      pushBoundary(
        obstacle.y,
        `${formatMm(obstacle.y)}`,
        "fixed",
        board.id,
        "min"
      );
      pushBoundary(
        obstacle.y + obstacle.height,
        `${formatMm(obstacle.y + obstacle.height)}`,
        "fixed",
        board.id,
        "max"
      );
    } else {
      if (probeValue < obstacle.y - rangeEps || probeValue > obstacle.y + obstacle.height + rangeEps) continue;
      pushBoundary(
        obstacle.x,
        `${formatMm(obstacle.x)}`,
        "fixed",
        board.id,
        "min"
      );
      pushBoundary(
        obstacle.x + obstacle.width,
        `${formatMm(obstacle.x + obstacle.width)}`,
        "fixed",
        board.id,
        "max"
      );
    }
  }

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

function buildTracePlacementForBoard(start, current, templateId, orientationOverride, boardIndexLimit, excludeBoardId) {
  const orientation = resolveTemplateOrientation(templateId, start, current, null, orientationOverride);
  const raw = normalizeRect(start, current);
  const base = applyTemplateThickness(raw, start, current, templateId, orientation);
  if (orientation !== "vertical" && orientation !== "horizontal") {
    return { localRect: base, orientation, traceMeta: null };
  }

  if (orientation === "vertical") {
    const probeX = clamp(base.x + base.width / 2, 0, cabinetModel.W);
    const seedY = clamp((start.y + current.y) / 2, 0, cabinetModel.H);
    const hits = raycastBidirectional(buildRayBoundariesForBoard("vertical", probeX, boardIndexLimit, excludeBoardId), seedY);
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
  const hits = raycastBidirectional(buildRayBoundariesForBoard("horizontal", probeY, boardIndexLimit, excludeBoardId), seedX);
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

function getBoardBoundaryExpr(board, axis, edge) {
  if (!board?.positionFormulas) return edge === "min" ? "0" : "0";
  const p = board.positionFormulas;
  const thicknessExpr = board.thicknessFormula || `${board.thickness}`;
  if (axis === "vertical") {
    if (edge === "min") return p.y;
    if (board.orientation === "horizontal") {
      return `(${p.y}) + (${thicknessExpr})`;
    }
    return `(${p.y}) + (${p.h})`;
  }
  if (edge === "min") return p.x;
  if (board.orientation === "vertical") {
    return `(${p.x}) + (${thicknessExpr})`;
  }
  return `(${p.x}) + (${p.w})`;
}

function refreshFabricationPolicyState(message) {
  if (!fabricationPolicyStateEl) return;
  const base = `結合ポリシー: 非結合固定 / 原板最大長さ: ${Math.round(fabricationPolicy.maxStockLength)} mm / クリアランスX:${formatMm(
    fabricationPolicy.defaultClearanceX
  )} Y:${formatMm(fabricationPolicy.defaultClearanceY)} mm`;
  fabricationPolicyStateEl.textContent = message ? `${base} / ${message}` : base;
}

function isMeaningfulOverlap(a, b) {
  const eps = 0.2;
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right - left > eps && bottom - top > eps;
}

function isEdgeContact(a, b) {
  const eps = 0.2;
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const touchOnVerticalEdge = Math.abs(a.x + a.width - b.x) <= eps || Math.abs(b.x + b.width - a.x) <= eps;
  const touchOnHorizontalEdge = Math.abs(a.y + a.height - b.y) <= eps || Math.abs(b.y + b.height - a.y) <= eps;
  return (touchOnVerticalEdge && overlapY > eps) || (touchOnHorizontalEdge && overlapX > eps);
}

function findIntersectingBoards(sourceBoard) {
  return boards.filter((candidate) => {
    if (candidate.id === sourceBoard.id) return false;
    return isMeaningfulOverlap(sourceBoard.localRect, candidate.localRect) || isEdgeContact(sourceBoard.localRect, candidate.localRect);
  });
}

function getPairIntersectionRect(a, b) {
  const left = Math.max(a.localRect.x, b.localRect.x);
  const right = Math.min(a.localRect.x + a.localRect.width, b.localRect.x + b.localRect.width);
  const top = Math.max(a.localRect.y, b.localRect.y);
  const bottom = Math.min(a.localRect.y + a.localRect.height, b.localRect.y + b.localRect.height);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function classifyJunctionKind(a, b) {
  const inter = getPairIntersectionRect(a, b);
  const eps = 0.2;
  if (inter.width <= eps || inter.height <= eps) return null;
  const av = a.orientation === "vertical";
  const ah = a.orientation === "horizontal";
  const bv = b.orientation === "vertical";
  const bh = b.orientation === "horizontal";
  if ((av && bh) || (ah && bv)) {
    const nearCenterA =
      Math.abs((inter.left + inter.right) / 2 - (a.localRect.x + a.localRect.width / 2)) < Math.max(2, a.thickness) &&
      Math.abs((inter.top + inter.bottom) / 2 - (a.localRect.y + a.localRect.height / 2)) < Math.max(2, a.thickness);
    const nearCenterB =
      Math.abs((inter.left + inter.right) / 2 - (b.localRect.x + b.localRect.width / 2)) < Math.max(2, b.thickness) &&
      Math.abs((inter.top + inter.bottom) / 2 - (b.localRect.y + b.localRect.height / 2)) < Math.max(2, b.thickness);
    if (nearCenterA && nearCenterB) return "X";
    return "T";
  }
  return "L";
}

function buildJunctions() {
  const junctions = [];
  for (let i = 0; i < boards.length; i += 1) {
    for (let j = i + 1; j < boards.length; j += 1) {
      const a = boards[i];
      const b = boards[j];
      const kind = classifyJunctionKind(a, b);
      if (!kind) continue;
      const inter = getPairIntersectionRect(a, b);
      junctions.push({
        id: `${a.id}__${b.id}`,
        kind,
        aId: a.id,
        bId: b.id,
        center: { x: (inter.left + inter.right) / 2, y: (inter.top + inter.bottom) / 2 },
      });
    }
  }
  return junctions;
}

function syncBoardFormulasFromRect(board) {
  if (!board) return;
  if (board.orientation === "vertical") {
    board.positionFormulas.x = formatMm(board.localRect.x);
    board.positionFormulas.y = formatMm(board.localRect.y);
    board.positionFormulas.h = formatMm(board.localRect.height);
    board.finishFormulas.H = formatMm(board.localRect.height);
    board.finishFormulas.W = formatMm(board.thickness);
  } else if (board.orientation === "horizontal") {
    board.positionFormulas.x = formatMm(board.localRect.x);
    board.positionFormulas.y = formatMm(board.localRect.y);
    board.positionFormulas.w = formatMm(board.localRect.width);
    board.finishFormulas.W = formatMm(board.localRect.width);
    board.finishFormulas.H = formatMm(board.thickness);
  }
}

function moveBoardAfter(anchorBoard, movedBoard) {
  if (!anchorBoard || !movedBoard || anchorBoard.id === movedBoard.id) return;
  const anchorIndex = boards.findIndex((item) => item.id === anchorBoard.id);
  const movedIndex = boards.findIndex((item) => item.id === movedBoard.id);
  if (anchorIndex < 0 || movedIndex < 0) return;
  const [picked] = boards.splice(movedIndex, 1);
  const nextAnchorIndex = boards.findIndex((item) => item.id === anchorBoard.id);
  const insertIndex = nextAnchorIndex + 1;
  boards.splice(insertIndex, 0, picked);
}

function shrinkBoardNearOpponentByLength(board, opponent, shrinkLength) {
  if (!board || !opponent) return 0;
  if (!Number.isFinite(shrinkLength) || shrinkLength <= 0) return 0;
  const axis = board.orientation === "vertical" ? "vertical" : board.orientation === "horizontal" ? "horizontal" : null;
  if (!axis) return 0;
  const next = { ...board.localRect };
  let delta = 0;

  if (axis === "horizontal") {
    const sourceMid = opponent.localRect.x + opponent.localRect.width / 2;
    const targetMid = board.localRect.x + board.localRect.width / 2;
    const maxShrink = Math.max(0, next.width - MIN_DRAW_SIZE_MM);
    delta = Math.min(shrinkLength, maxShrink);
    if (delta <= 0) return 0;
    if (sourceMid < targetMid) {
      next.x += delta;
      next.width -= delta;
    } else {
      next.width -= delta;
    }
  } else {
    const sourceMid = opponent.localRect.y + opponent.localRect.height / 2;
    const targetMid = board.localRect.y + board.localRect.height / 2;
    const maxShrink = Math.max(0, next.height - MIN_DRAW_SIZE_MM);
    delta = Math.min(shrinkLength, maxShrink);
    if (delta <= 0) return 0;
    if (sourceMid < targetMid) {
      next.y += delta;
      next.height -= delta;
    } else {
      next.height -= delta;
    }
  }

  board.localRect = clampLocalRect(next);
  syncBoardFormulasFromRect(board);
  applyPlacementMeta(board);
  applyLocalRectToNode(board, board.localRect);
  return delta;
}

function applyCollisionMarkerAction(junction) {
  if (!junction || typeof window === "undefined" || typeof window.confirm !== "function") return;
  const a = boards.find((item) => item.id === junction.aId);
  const b = boards.find((item) => item.id === junction.bId);
  if (!a || !b) return;
  const useA = window.confirm(
    `衝突を検出しました。\nこちらを変更しますか？\nはい: ${a.name}\nいいえ: ${b.name}`
  );
  const source = useA ? a : b;
  const opponent = useA ? b : a;
  const action = window.prompt(
    [
      "操作を選んでください:",
      "1: こちらを伸ばし相手を縮める",
      "2: やっぱりやめる",
      "3: 相手も伸ばしたままにする（重なり許可）",
      "入力: 1 / 2 / 3",
    ].join("\n"),
    "1"
  );
  if (action === null) return;
  const normalized = `${action}`.trim();
  if (normalized === "2") return;
  if (normalized !== "1" && normalized !== "3") {
    refreshFabricationPolicyState("衝突操作を中止: 1 / 2 / 3 のいずれかを入力してください。");
    return;
  }
  const pairKey = [source.id, opponent.id].sort().join("|");
  const allowOverlap = normalized === "3";
  const accepted = runWithPropagationGuard(null, () => {
    const extendedBy = extendBoardTowardOpponentByLength(source, opponent);
    if (extendedBy <= 0) return;
    if (allowOverlap) {
      halfLapPairKeys.add(pairKey);
    } else {
      halfLapPairKeys.delete(pairKey);
      shrinkBoardNearOpponentByLength(opponent, source, extendedBy);
    }
    syncBoardFormulasFromRect(source);
    applyPlacementMeta(source);
    moveBoardAfter(opponent, source);
  });
  if (!accepted) {
    const message = allowOverlap
      ? "衝突伸長をロールバック: 例外許可でも整合を保てませんでした。"
      : "衝突伸長をロールバック: 非重なり条件を満たせませんでした。";
    refreshFabricationPolicyState(message);
    return;
  }
  updatePartsList();
  refreshHud();
  refreshJunctionMarkers();
  layer.batchDraw();
  const modeLabel = allowOverlap ? "相手をそのまま（重なり例外）" : "相手を縮める";
  refreshFabricationPolicyState(`衝突伸長を適用: ${source.name} を伸長 / ${modeLabel} / 配置順を更新`);
}

function extendBoardTowardOpponentByLength(board, opponent) {
  if (!board || !opponent) return 0;
  const axis = board.orientation === "vertical" ? "vertical" : board.orientation === "horizontal" ? "horizontal" : null;
  if (!axis) return 0;

  const extendLength = Number.isFinite(opponent.thickness) ? Math.max(0, opponent.thickness) : 0;
  if (extendLength <= 0) return 0;
  const next = { ...board.localRect };
  let delta = 0;
  if (axis === "horizontal") {
    const boardMid = board.localRect.x + board.localRect.width / 2;
    const opponentMid = opponent.localRect.x + opponent.localRect.width / 2;
    if (opponentMid < boardMid) {
      delta = Math.min(extendLength, next.x);
      next.x -= delta;
      next.width += delta;
    } else {
      delta = Math.min(extendLength, cabinetModel.W - (next.x + next.width));
      next.width += delta;
    }
  } else {
    const boardMid = board.localRect.y + board.localRect.height / 2;
    const opponentMid = opponent.localRect.y + opponent.localRect.height / 2;
    if (opponentMid < boardMid) {
      delta = Math.min(extendLength, next.y);
      next.y -= delta;
      next.height += delta;
    } else {
      delta = Math.min(extendLength, cabinetModel.H - (next.y + next.height));
      next.height += delta;
    }
  }
  if (delta <= 0) return 0;

  board.localRect = clampLocalRect(next);
  syncBoardFormulasFromRect(board);
  applyPlacementMeta(board);
  applyLocalRectToNode(board, board.localRect);
  return delta;
}


function splitTargetByPasser(targetBoard, passerBoard) {
  if (!targetBoard || !passerBoard) return false;
  const targetIdx = boards.findIndex((item) => item.id === targetBoard.id);
  if (targetIdx < 0) return false;
  const orient = targetBoard.orientation;
  if (orient !== "horizontal" && orient !== "vertical") return false;
  const baseNo = boardCounter;
  const segA = {
    ...targetBoard,
    id: `part-${baseNo}`,
    drawingNo: `${DRAWING_NO_PREFIX}${String(baseNo).padStart(4, "0")}`,
    localRect: { ...targetBoard.localRect },
    positionFormulas: { ...targetBoard.positionFormulas },
    finishFormulas: { ...targetBoard.finishFormulas },
    traceMeta: null,
    node: null,
  };
  const segB = {
    ...targetBoard,
    id: `part-${baseNo + 1}`,
    drawingNo: `${DRAWING_NO_PREFIX}${String(baseNo + 1).padStart(4, "0")}`,
    localRect: { ...targetBoard.localRect },
    positionFormulas: { ...targetBoard.positionFormulas },
    finishFormulas: { ...targetBoard.finishFormulas },
    traceMeta: null,
    node: null,
  };

  if (orient === "horizontal") {
    const cutMin = passerBoard.localRect.x;
    const cutMax = passerBoard.localRect.x + passerBoard.localRect.width;
    const leftLen = cutMin - targetBoard.localRect.x;
    const rightLen = targetBoard.localRect.x + targetBoard.localRect.width - cutMax;
    if (leftLen < MIN_DRAW_SIZE_MM || rightLen < MIN_DRAW_SIZE_MM) return false;
    segA.localRect = clampLocalRect({ ...targetBoard.localRect, width: leftLen });
    segB.localRect = clampLocalRect({ ...targetBoard.localRect, x: cutMax, width: rightLen });
    segA.positionFormulas.w = `(${passerBoard.positionFormulas.x}) - (${targetBoard.positionFormulas.x})`;
    segB.positionFormulas.x = `(${passerBoard.positionFormulas.x}) + (${passerBoard.positionFormulas.w})`;
    segB.positionFormulas.w = `((${targetBoard.positionFormulas.x}) + (${targetBoard.positionFormulas.w})) - ((${passerBoard.positionFormulas.x}) + (${passerBoard.positionFormulas.w}))`;
    segA.finishFormulas.W = formatMm(segA.localRect.width);
    segB.finishFormulas.W = formatMm(segB.localRect.width);
  } else {
    const cutMin = passerBoard.localRect.y;
    const cutMax = passerBoard.localRect.y + passerBoard.localRect.height;
    const topLen = cutMin - targetBoard.localRect.y;
    const bottomLen = targetBoard.localRect.y + targetBoard.localRect.height - cutMax;
    if (topLen < MIN_DRAW_SIZE_MM || bottomLen < MIN_DRAW_SIZE_MM) return false;
    segA.localRect = clampLocalRect({ ...targetBoard.localRect, height: topLen });
    segB.localRect = clampLocalRect({ ...targetBoard.localRect, y: cutMax, height: bottomLen });
    segA.positionFormulas.h = `(${passerBoard.positionFormulas.y}) - (${targetBoard.positionFormulas.y})`;
    segB.positionFormulas.y = `(${passerBoard.positionFormulas.y}) + (${passerBoard.positionFormulas.h})`;
    segB.positionFormulas.h = `((${targetBoard.positionFormulas.y}) + (${targetBoard.positionFormulas.h})) - ((${passerBoard.positionFormulas.y}) + (${passerBoard.positionFormulas.h}))`;
    segA.finishFormulas.H = formatMm(segA.localRect.height);
    segB.finishFormulas.H = formatMm(segB.localRect.height);
  }

  targetBoard.node?.destroy();
  segA.node = createBoardNode(segA);
  segB.node = createBoardNode(segB);
  applyPlacementMeta(segA);
  applyPlacementMeta(segB);
  boards.splice(targetIdx, 1);
  const passerIdx = boards.findIndex((item) => item.id === passerBoard.id);
  const insertIdx = passerIdx >= 0 ? passerIdx + 1 : boards.length;
  boards.splice(insertIdx, 0, segA, segB);
  layer.add(segA.node);
  layer.add(segB.node);
  boardCounter += 2;
  return true;
}

function tryMergeAdjacentBoards() {
  for (let i = 0; i < boards.length; i += 1) {
    for (let j = i + 1; j < boards.length; j += 1) {
      const a = boards[i];
      const b = boards[j];
      if (!a || !b) continue;
      if (a.orientation !== b.orientation) continue;
      if (a.orientation !== "horizontal" && a.orientation !== "vertical") continue;
      if (a.matId !== b.matId || a.thickness !== b.thickness) continue;

      if (a.orientation === "horizontal") {
        if (Math.abs(a.localRect.y - b.localRect.y) > 0.2 || Math.abs(a.localRect.height - b.localRect.height) > 0.2) continue;
        const left = a.localRect.x <= b.localRect.x ? a : b;
        const right = left === a ? b : a;
        if (Math.abs(left.localRect.x + left.localRect.width - right.localRect.x) > 0.2) continue;
        const mergedRect = {
          x: left.localRect.x,
          y: left.localRect.y,
          width: left.localRect.width + right.localRect.width,
          height: left.localRect.height,
        };
        if (overlapsAnyOtherBoard(mergedRect, left.id, getBoardPadding(left))) continue;
        left.localRect = clampLocalRect(mergedRect);
        left.positionFormulas.x = formatMm(left.localRect.x);
        left.positionFormulas.w = formatMm(left.localRect.width);
        left.finishFormulas.W = formatMm(left.localRect.width);
        right.node?.destroy();
        boards.splice(boards.indexOf(right), 1);
        return true;
      }

      if (Math.abs(a.localRect.x - b.localRect.x) > 0.2 || Math.abs(a.localRect.width - b.localRect.width) > 0.2) continue;
      const top = a.localRect.y <= b.localRect.y ? a : b;
      const bottom = top === a ? b : a;
      if (Math.abs(top.localRect.y + top.localRect.height - bottom.localRect.y) > 0.2) continue;
      const mergedRect = {
        x: top.localRect.x,
        y: top.localRect.y,
        width: top.localRect.width,
        height: top.localRect.height + bottom.localRect.height,
      };
      if (overlapsAnyOtherBoard(mergedRect, top.id, getBoardPadding(top))) continue;
      top.localRect = clampLocalRect(mergedRect);
      top.positionFormulas.y = formatMm(top.localRect.y);
      top.positionFormulas.h = formatMm(top.localRect.height);
      top.finishFormulas.H = formatMm(top.localRect.height);
      bottom.node?.destroy();
      boards.splice(boards.indexOf(bottom), 1);
      return true;
    }
  }
  return false;
}

function clearJunctionMarkers() {
  junctionMarkers.forEach((item) => item.destroy());
  junctionMarkers.length = 0;
}

function detectJunctions() {
  return buildJunctions();
}

function refreshJunctionMarkers() {
  clearJunctionMarkers();
  const junctions = detectJunctions();
  junctions.forEach((junction) => {
    const center = localToStagePoint(junction.center);
    const group = new Konva.Group({ x: center.x, y: center.y, draggable: false });
    const circle = new Konva.Circle({
      radius: 11,
      fill: "rgba(30,64,175,0.18)",
      stroke: "#1e3a8a",
      strokeWidth: 1.2,
    });
    const label = new Konva.Text({
      x: -18,
      y: -6,
      width: 36,
      align: "center",
      fontSize: 11,
      fill: "#1e3a8a",
      text: "衝突",
      listening: false,
    });
    group.add(circle);
    group.add(label);
    group.on("click tap", () => {
      applyCollisionMarkerAction(junction);
    });
    layer.add(group);
    group.moveToTop();
    junctionMarkers.push(group);
  });
}

function hasAnyBoardOverlap() {
  for (let i = 0; i < boards.length; i += 1) {
    for (let j = i + 1; j < boards.length; j += 1) {
      const pairKey = [boards[i].id, boards[j].id].sort().join("|");
      if (halfLapPairKeys.has(pairKey)) continue;
      if (rectsOverlap(getBoardCollisionRect(boards[i]), getBoardCollisionRect(boards[j]))) return true;
    }
  }
  return false;
}

function snapshotBoardsState() {
  const snap = {};
  boards.forEach((board) => {
    snap[board.id] = {
      localRect: { ...board.localRect },
      finishFormulas: { ...board.finishFormulas },
      positionFormulas: { ...board.positionFormulas },
      placementSide: board.placementSide,
      isMirrored: board.isMirrored,
    };
  });
  return {
    boards: snap,
    halfLapPairKeys: [...halfLapPairKeys],
  };
}

function restoreBoardsState(snapshot) {
  halfLapPairKeys.clear();
  (snapshot.halfLapPairKeys || []).forEach((key) => halfLapPairKeys.add(key));
  boards.forEach((board) => {
    const saved = snapshot.boards?.[board.id];
    if (!saved) return;
    board.localRect = { ...saved.localRect };
    board.finishFormulas = { ...saved.finishFormulas };
    board.positionFormulas = { ...saved.positionFormulas };
    board.placementSide = saved.placementSide;
    board.isMirrored = saved.isMirrored;
    applyLocalRectToNode(board, board.localRect);
  });
}

function runWithPropagationGuard(sourceBoardId, mutateFn) {
  const snapshot = snapshotBoardsState();
  mutateFn();
  const ok = recalcAllBoardsFromZero(sourceBoardId || null);
  if (!ok) {
    restoreBoardsState(snapshot);
    return false;
  }
  if (hasAnyBoardOverlap()) {
    restoreBoardsState(snapshot);
    return false;
  }
  return true;
}

function evaluateBoardFormula(formula, board, fallback) {
  if (formula === undefined || formula === null || formula === "") return fallback;
  try {
    return evaluateFormula(formula, {
      $W: cabinetModel.W,
      $H: cabinetModel.H,
      $D: cabinetModel.D,
      $T: board.thickness,
    });
  } catch (error) {
    return fallback;
  }
}

function resolveBoardRectFromFormulas(board) {
  const fromFormulas = {
    x: evaluateBoardFormula(board.positionFormulas?.x, board, board.localRect.x),
    y: evaluateBoardFormula(board.positionFormulas?.y, board, board.localRect.y),
    width: evaluateBoardFormula(board.positionFormulas?.w, board, board.localRect.width),
    height: evaluateBoardFormula(board.positionFormulas?.h, board, board.localRect.height),
  };
  if (board.orientation === "vertical") {
    fromFormulas.width = board.thickness;
  } else if (board.orientation === "horizontal") {
    fromFormulas.height = board.thickness;
  }
  return clampBoardRectByOrientation(board, fromFormulas);
}

function buildPhysicalGrowthRect(board, index) {
  const origin = {
    x: board.localRect.x + board.localRect.width / 2,
    y: board.localRect.y + board.localRect.height / 2,
  };
  const boundedOrigin = {
    x: clamp(origin.x, 0, cabinetModel.W),
    y: clamp(origin.y, 0, cabinetModel.H),
  };

  if (board.orientation === "vertical") {
    const boundaries = buildRayBoundariesForBoard("vertical", boundedOrigin.x, index, board.id);
    const hits = raycastBidirectional(boundaries, boundedOrigin.y);
    if (!hits?.negative || !hits?.positive || hits.positive.value <= hits.negative.value) return null;
    return {
      rect: clampBoardRectByOrientation(board, {
        x: boundedOrigin.x - board.thickness / 2,
        y: hits.negative.value,
        width: board.thickness,
        height: hits.positive.value - hits.negative.value,
      }),
      traceMeta: {
        axis: "vertical",
        probe: boundedOrigin.x,
        negative: hits.negative,
        positive: hits.positive,
      },
    };
  }

  if (board.orientation === "horizontal") {
    const boundaries = buildRayBoundariesForBoard("horizontal", boundedOrigin.y, index, board.id);
    const hits = raycastBidirectional(boundaries, boundedOrigin.x);
    if (!hits?.negative || !hits?.positive || hits.positive.value <= hits.negative.value) return null;
    return {
      rect: clampBoardRectByOrientation(board, {
        x: hits.negative.value,
        y: boundedOrigin.y - board.thickness / 2,
        width: hits.positive.value - hits.negative.value,
        height: board.thickness,
      }),
      traceMeta: {
        axis: "horizontal",
        probe: boundedOrigin.y,
        negative: hits.negative,
        positive: hits.positive,
      },
    };
  }

  return { rect: resolveBoardRectFromFormulas(board), traceMeta: null };
}

function rebuildBoardFromIndex(board, index) {
  if (!board) return;
  if (board.orientation === "vertical" || board.orientation === "horizontal") {
    const grown = buildPhysicalGrowthRect(board, index);
    if (grown) {
      board.localRect = grown.rect;
      if (grown.traceMeta?.axis === "horizontal") {
        board.positionFormulas.x = formatMm(grown.rect.x);
        board.positionFormulas.w = formatMm(grown.rect.width);
        board.finishFormulas.W = formatMm(grown.rect.width);
      }
      if (grown.traceMeta?.axis === "vertical") {
        board.positionFormulas.y = formatMm(grown.rect.y);
        board.positionFormulas.h = formatMm(grown.rect.height);
        board.finishFormulas.H = formatMm(grown.rect.height);
      }
    } else {
      board.localRect = resolveBoardRectFromFormulas(board);
    }
  } else {
    board.localRect = resolveBoardRectFromFormulas(board);
  }
  applyPlacementMeta(board);
}

function recalcAllBoardsFromZero(sourceBoardId = null) {
  if (boards.length === 0) {
    refreshJunctionMarkers();
    return true;
  }

  for (let i = 0; i < boards.length; i += 1) {
    const board = boards[i];
    rebuildBoardFromIndex(board, i);
    applyLocalRectToNode(board, board.localRect);
  }

  refreshJunctionMarkers();
  return !hasAnyBoardOverlap();
}

function isParametricExpression(expr) {
  if (typeof expr !== "string") return false;
  return /\$[A-Za-z_]+/.test(expr) || /part-\d+/.test(expr);
}

function scaleValueByRatio(value, ratio, max) {
  if (!Number.isFinite(value) || !Number.isFinite(ratio) || ratio <= 0) return value;
  return clamp(value * ratio, 0, max);
}

function applyCabinetResizeTransform(previousCabinet) {
  if (!previousCabinet || !Number.isFinite(previousCabinet.W) || !Number.isFinite(previousCabinet.H)) return;
  if (previousCabinet.W <= 0 || previousCabinet.H <= 0) return;
  if (boards.length === 0) return;

  const ratioX = cabinetModel.W / previousCabinet.W;
  const ratioY = cabinetModel.H / previousCabinet.H;

  boards.forEach((board) => {
    if (!board?.localRect) return;
    const prevRect = { ...board.localRect };
    const nextRect = { ...prevRect };
    const fromFormulaRect = resolveBoardRectFromFormulas(board);
    const formulaX = isParametricExpression(board.positionFormulas?.x);
    const formulaY = isParametricExpression(board.positionFormulas?.y);
    const formulaW = isParametricExpression(board.positionFormulas?.w);
    const formulaH = isParametricExpression(board.positionFormulas?.h);

    nextRect.x = formulaX ? fromFormulaRect.x : scaleValueByRatio(prevRect.x, ratioX, cabinetModel.W);
    nextRect.y = formulaY ? fromFormulaRect.y : scaleValueByRatio(prevRect.y, ratioY, cabinetModel.H);
    nextRect.width = formulaW ? fromFormulaRect.width : prevRect.width * ratioX;
    nextRect.height = formulaH ? fromFormulaRect.height : prevRect.height * ratioY;

    if (board.orientation === "vertical") {
      nextRect.width = board.thickness;
    } else if (board.orientation === "horizontal") {
      nextRect.height = board.thickness;
    }

    board.localRect = clampBoardRectByOrientation(board, nextRect);
    applyPlacementMeta(board);
    applyLocalRectToNode(board, board.localRect);
  });

  guideLines.forEach((guide) => {
    if (!guide) return;
    if (guide.orientation === "vertical") {
      guide.value = clamp(guide.value * ratioX, 0, cabinetModel.W);
    } else {
      guide.value = clamp(guide.value * ratioY, 0, cabinetModel.H);
    }
    if (!isParametricExpression(guide.expr)) {
      guide.expr = formatMm(guide.value);
    }
    updateGuideLineNode(guide);
  });
}

function recalcBoardsAfterParentResize(previousCabinet = null) {
  const snapshot = snapshotBoardsState();
  applyCabinetResizeTransform(previousCabinet);
  recalcAllBoardsFromZero();

  if (hasAnyBoardOverlap()) {
    restoreBoardsState(snapshot);
    return false;
  }
  return true;
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

function mmLabel(value) {
  return `${Math.round(value * 10) / 10} mm`;
}

function getActualLengthMm(board) {
  if (board.orientation === "horizontal") return board.localRect.width;
  if (board.orientation === "vertical") return board.localRect.height;
  return Math.max(board.localRect.width, board.localRect.height);
}

function getActualOrderSize(board, dims) {
  const length = getActualLengthMm(board);
  const depth = dims.order.D ?? cabinetModel.D;
  return { length, depth };
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

function getSectionPlaneAxis() {
  return sectionAxisEl?.value === "y" ? "y" : "x";
}

function buildSectionAnchorValue(axis, anchor) {
  if (axis === "x") {
    if (anchor === "left") return 0;
    if (anchor === "center") return cabinetModel.W / 2;
    if (anchor === "right") return cabinetModel.W;
    return clamp(Number(sectionPlaneMmEl?.value || 0), 0, cabinetModel.W);
  }
  if (anchor === "top") return 0;
  if (anchor === "middle") return cabinetModel.H / 2;
  if (anchor === "bottom") return cabinetModel.H;
  return clamp(Number(sectionPlaneMmEl?.value || 0), 0, cabinetModel.H);
}

function setSectionPlaneValue(mm) {
  if (!sectionPlaneMmEl) return;
  sectionPlaneMmEl.value = `${Math.round(mm * 10) / 10}`;
  updateSectionPlanePreview();
}

function getSectionPlaneValue() {
  if (!sectionPlaneMmEl) return 0;
  const parsed = Number(sectionPlaneMmEl.value);
  const max = getSectionPlaneAxis() === "y" ? cabinetModel.H : cabinetModel.W;
  if (!Number.isFinite(parsed)) return clamp(max / 2, 0, max);
  return clamp(parsed, 0, max);
}

function updateSectionPlanePreview() {
  if (!layer) return;
  if (!scalePlaneOverlay) {
    scalePlaneOverlay = new Konva.Line({
      stroke: "#ef4444",
      strokeWidth: 1.5,
      dash: [4, 4],
      listening: false,
      visible: false,
      opacity: 0.8,
    });
    layer.add(scalePlaneOverlay);
  }
  const axis = getSectionPlaneAxis();
  const value = getSectionPlaneValue();
  if (axis === "x") {
    const p1 = localToStagePoint({ x: value, y: 0 });
    const p2 = localToStagePoint({ x: value, y: cabinetModel.H });
    scalePlaneOverlay.points([p1.x, p1.y, p2.x, p2.y]);
  } else {
    const p1 = localToStagePoint({ x: 0, y: value });
    const p2 = localToStagePoint({ x: cabinetModel.W, y: value });
    scalePlaneOverlay.points([p1.x, p1.y, p2.x, p2.y]);
  }
  scalePlaneOverlay.visible(true);
  scalePlaneOverlay.moveToTop();
  layer.batchDraw();
}

function moveGuideBySectionPlane(guide, axis, plane, delta, sideMode, uniform) {
  if (!guide) return;
  const guideAxis = guide.orientation === "vertical" ? "x" : "y";
  if (guideAxis !== axis) return;
  const signedDelta = uniform ? (guide.value >= plane ? delta : -delta) : sideMode === "negative" ? (guide.value <= plane ? delta : 0) : guide.value >= plane ? delta : 0;
  if (Math.abs(signedDelta) < 0.001) return;
  const max = axis === "x" ? cabinetModel.W : cabinetModel.H;
  guide.value = clamp(guide.value + signedDelta, 0, max);
  if (!isParametricExpression(guide.expr)) {
    guide.expr = formatMm(guide.value);
  }
  updateGuideLineNode(guide);
}

function moveBoardBySectionPlane(board, axis, plane, delta, sideMode, uniform) {
  if (!board?.localRect) return;
  const rect = { ...board.localRect };
  if (axis === "x") {
    const left = rect.x;
    const right = rect.x + rect.width;
    if (uniform) {
      const offset = right <= plane ? -delta : left >= plane ? delta : 0;
      if (Math.abs(offset) > 0.001) rect.x += offset;
    } else if (sideMode === "positive") {
      if (left >= plane) rect.x += delta;
    } else if (right <= plane) {
      rect.x += delta;
    }
  } else {
    const top = rect.y;
    const bottom = rect.y + rect.height;
    if (uniform) {
      const offset = bottom <= plane ? -delta : top >= plane ? delta : 0;
      if (Math.abs(offset) > 0.001) rect.y += offset;
    } else if (sideMode === "positive") {
      if (top >= plane) rect.y += delta;
    } else if (bottom <= plane) {
      rect.y += delta;
    }
  }
  board.localRect = clampBoardRectByOrientation(board, rect);
  syncBoardFormulasFromRect(board);
  applyPlacementMeta(board);
  applyLocalRectToNode(board, board.localRect);
}

function applySectionPlaneStretch() {
  const axis = getSectionPlaneAxis();
  const plane = getSectionPlaneValue();
  const delta = Number(sectionDeltaMmEl?.value || 0);
  const sideMode = sectionSideModeEl?.value === "negative" ? "negative" : "positive";
  const uniform = !!sectionUniformToggleEl?.checked;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.001) {
    refreshFabricationPolicyState("断面平面伸縮: Δ(mm) を入力してください。");
    return;
  }
  const accepted = runWithPropagationGuard(null, () => {
    boards.forEach((board) => moveBoardBySectionPlane(board, axis, plane, delta, sideMode, uniform));
    guideLines.forEach((guide) => moveGuideBySectionPlane(guide, axis, plane, delta, sideMode, uniform));
  });
  if (!accepted) {
    refreshFabricationPolicyState("断面平面伸縮をロールバック: 非重なり条件を満たせませんでした。");
    updateSectionPlanePreview();
    return;
  }
  updatePartsList();
  refreshHud();
  updateSectionPlanePreview();
  refreshFabricationPolicyState(`断面平面伸縮を適用: axis=${axis} plane=${formatMm(plane)} Δ=${formatMm(delta)}${uniform ? " (均等)" : ""}`);
  layer.batchDraw();
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

function drawCabinetFrame(resetBoards = false) {
  const previousCabinet = { W: cabinetModel.W, H: cabinetModel.H, D: cabinetModel.D };
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

  let resizeAccepted = true;
  if (resetBoards) {
    clearBoards();
  } else {
    resizeAccepted = recalcBoardsAfterParentResize(previousCabinet);
    updatePartsList();
    refreshHud();
    if (!resizeAccepted) {
      refreshFabricationPolicyState("外寸変更をロールバック: 非重なり条件を満たせませんでした。");
    } else {
      refreshFabricationPolicyState("外寸変更を適用: 既存部材を再計算しました。");
    }
  }
  guideLines.forEach((guide) => updateGuideLineNode(guide));
  refreshJunctionMarkers();
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

function clampBoardRectByOrientation(board, rect) {
  if (!board) return clampLocalRect(rect);
  if (board.orientation === "vertical") {
    const width = Math.max(0.1, Number(board.thickness) || 0.1);
    const height = clamp(rect.height, MIN_DRAW_SIZE_MM, cabinetModel.H);
    return {
      x: clamp(rect.x, 0, cabinetModel.W - width),
      y: clamp(rect.y, 0, cabinetModel.H - height),
      width,
      height,
    };
  }
  if (board.orientation === "horizontal") {
    const height = Math.max(0.1, Number(board.thickness) || 0.1);
    const width = clamp(rect.width, MIN_DRAW_SIZE_MM, cabinetModel.W);
    return {
      x: clamp(rect.x, 0, cabinetModel.W - width),
      y: clamp(rect.y, 0, cabinetModel.H - height),
      width,
      height,
    };
  }
  return clampLocalRect(rect);
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
    const current = stageToLocalPoint({ x: node.x(), y: node.y() });
    const snapped = snapLocalPoint(current);
    const rawRect = clampLocalRect({
      ...board.localRect,
      x: snapped.x,
      y: snapped.y,
    });
    const nextRect = applyMoveAxisConstraint(rawRect, board.localRect, board.orientation);
    const accepted = runWithPropagationGuard(board.id, () => {
      board.localRect = nextRect;
      applyPlacementMeta(board);
      if (board.orientation === "vertical") {
        board.positionFormulas.x = snapped.snappedX ? toRelativeFormula(nextRect.x, snapped.refXValue, snapped.refXExpr) : formatMm(nextRect.x);
      } else if (board.orientation === "horizontal") {
        board.positionFormulas.y = snapped.snappedY ? toRelativeFormula(nextRect.y, snapped.refYValue, snapped.refYExpr) : formatMm(nextRect.y);
      } else {
        board.positionFormulas.x = snapped.snappedX ? toRelativeFormula(nextRect.x, snapped.refXValue, snapped.refXExpr) : formatMm(nextRect.x);
        board.positionFormulas.y = snapped.snappedY ? toRelativeFormula(nextRect.y, snapped.refYValue, snapped.refYExpr) : formatMm(nextRect.y);
      }
      applyLocalRectToNode(board, nextRect);
    });
    if (!accepted) {
      applyLocalRectToNode(board, board.localRect);
      return;
    }
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
    nextRect = applyTemplateThickness(nextRect, nextRect, nextRect, board.templateId, board.orientation);
    const accepted = runWithPropagationGuard(board.id, () => {
      board.localRect = nextRect;
      applyPlacementMeta(board);
      board.finishFormulas = buildFinishFormulas(board.templateId, nextRect, board.thickness, board.orientation);
      board.positionFormulas = buildPositionFormulas(nextRect, null, null, board.templateId, board.orientation);
      applyLocalRectToNode(board, nextRect);
    });
    if (!accepted) {
      applyLocalRectToNode(board, board.localRect);
      layer.batchDraw();
      return;
    }
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
  const finishFormulas = buildFinishFormulas(templateId, localRect, thickness, orientation);
  const positionFormulas = buildPositionFormulas(localRect, start, end, templateId, orientation);
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
    clearanceX: fabricationPolicy.defaultClearanceX,
    clearanceY: fabricationPolicy.defaultClearanceY,
    drawingNo: `${DRAWING_NO_PREFIX}${String(boardCounter).padStart(4, "0")}`,
    marginFormulas: { W: `${DEFAULT_MARGIN_MM}`, H: `${DEFAULT_MARGIN_MM}`, D: `${DEFAULT_MARGIN_MM}` },
    localRect,
    traceMeta: null,
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
    const dims = resolvePartDimensions(board);
    const actual = getActualOrderSize(board, dims);
    const key = `${board.name} / ${board.matId} / t${board.thickness} / ${Math.round(actual.length)}x${Math.round(actual.depth)}`;
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
          <div class="row"><span>実部品寸法（長さx奥行）</span><strong>${dimsLabel(getActualLengthMm(board), dims.finish.D ?? cabinetModel.D)}</strong></div>
          <div class="row"><span>発注寸法（長さx奥行）</span><strong>${dimsLabel(getActualOrderSize(board, dims).length, getActualOrderSize(board, dims).depth)}</strong></div>
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
  const expanded = buildTracePlacementForBoard(startSnap, snapped, templateSelectEl.value, null, boards.length, null);
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
  if (overlapsAnyOtherBoard(board.localRect, board.id, getBoardPadding(board))) {
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
  const accepted = recalcAllBoardsFromZero();
  if (!accepted) {
    board.node.destroy();
    boards.pop();
    recalcAllBoardsFromZero();
    if (draftRect) {
      draftRect.size({ width: 0, height: 0 });
      draftText.text("");
    }
    if (draftRayLine) draftRayLine.points([]);
    currentTraceMeta = null;
    updatePartsList();
    layer.batchDraw();
    return;
  }
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

  const accepted = runWithPropagationGuard(board.id, () => {
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
      if (board.orientation === "vertical") {
        next.x += deltaMm;
      } else if (board.orientation === "horizontal") {
        next.y += deltaMm;
      } else {
        next.x += deltaMm;
        next.y += deltaMm;
      }
      board.localRect = clampLocalRect(next);
      applyPlacementMeta(board);
      if (board.orientation === "vertical") {
        board.positionFormulas.x = formatMm(board.localRect.x);
      } else if (board.orientation === "horizontal") {
        board.positionFormulas.y = formatMm(board.localRect.y);
      } else {
        board.positionFormulas.x = formatMm(board.localRect.x);
        board.positionFormulas.y = formatMm(board.localRect.y);
      }
    }
    applyLocalRectToNode(board, board.localRect);
  });
  if (!accepted) {
    applyLocalRectToNode(board, board.localRect);
    layer.batchDraw();
    return;
  }

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

  applyCabinetBtn.addEventListener("click", () => drawCabinetFrame(false));
  if (maxStockLengthEl) {
    maxStockLengthEl.addEventListener("change", () => {
      const parsed = Number(maxStockLengthEl.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        fabricationPolicy.maxStockLength = parsed;
      }
      refreshFabricationPolicyState();
    });
  }
  if (clearanceXEl) {
    clearanceXEl.addEventListener("change", () => {
      const parsed = Number(clearanceXEl.value);
      fabricationPolicy.defaultClearanceX = Number.isFinite(parsed) && parsed >= 0 ? parsed : fabricationPolicy.defaultClearanceX;
      boards.forEach((board) => {
        board.clearanceX = fabricationPolicy.defaultClearanceX;
      });
      recalcAllBoardsFromZero();
      updatePartsList();
      layer.batchDraw();
      refreshFabricationPolicyState();
    });
  }
  if (clearanceYEl) {
    clearanceYEl.addEventListener("change", () => {
      const parsed = Number(clearanceYEl.value);
      fabricationPolicy.defaultClearanceY = Number.isFinite(parsed) && parsed >= 0 ? parsed : fabricationPolicy.defaultClearanceY;
      boards.forEach((board) => {
        board.clearanceY = fabricationPolicy.defaultClearanceY;
      });
      recalcAllBoardsFromZero();
      updatePartsList();
      layer.batchDraw();
      refreshFabricationPolicyState();
    });
  }
  const bindSectionAnchor = (btn, axis, anchor) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (sectionAxisEl) sectionAxisEl.value = axis;
      setSectionPlaneValue(buildSectionAnchorValue(axis, anchor));
      updateSectionPlanePreview();
    });
  };
  bindSectionAnchor(sectionHandleLeftBtn, "x", "left");
  bindSectionAnchor(sectionHandleCenterXBtn, "x", "center");
  bindSectionAnchor(sectionHandleRightBtn, "x", "right");
  bindSectionAnchor(sectionHandleTopBtn, "y", "top");
  bindSectionAnchor(sectionHandleMiddleYBtn, "y", "middle");
  bindSectionAnchor(sectionHandleBottomBtn, "y", "bottom");
  if (sectionAxisEl) sectionAxisEl.addEventListener("change", updateSectionPlanePreview);
  if (sectionPlaneMmEl) sectionPlaneMmEl.addEventListener("input", updateSectionPlanePreview);
  if (applySectionStretchBtn) applySectionStretchBtn.addEventListener("click", () => applySectionPlaneStretch());
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
  refreshFabricationPolicyState();
  refreshHud();
}

initStage();
