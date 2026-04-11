const DEFAULT_MARGIN_MM = 15;
const MIN_DRAW_SIZE = 20;
const SNAP_DISTANCE = 12;
const DRAWING_NO_PREFIX = "WB-";

const stageContainer = document.getElementById("stage-container");
const partsListEl = document.getElementById("parts-list");
const hudStateEl = document.getElementById("hud-state");

let stage;
let layer;
let tr;
let isDrawing = false;
let startPoint = null;
let snappedStartPoint = null;
let draftRect = null;
let draftText = null;
let currentRect = null;
let selectedNode = null;
let lastHudOperation = "move";

const boards = [];
let boardCounter = 1;
const keyBuffer = {
  text: "",
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
      if ((num.match(/\./g) || []).length > 1 || num === ".") {
        throw new FormulaSyntaxError("Invalid number literal");
      }
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
    if (current().type !== type) {
      throw new FormulaSyntaxError(`Expected "${type}" but got "${current().type}"`);
    }
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
  if (current().type !== "eof") {
    throw new FormulaSyntaxError("Unexpected tokens in formula");
  }
  return ast;
}

function evaluateAst(node, vars) {
  if (node.kind === "number") return node.value;
  if (node.kind === "identifier") {
    const key = node.value.startsWith("$") ? node.value.slice(1) : node.value;
    const value = vars[node.value] ?? vars[key] ?? vars[`$${key}`];
    if (value === undefined) {
      throw new FormulaEvaluationError(`Unknown variable "${node.value}"`);
    }
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
  if (typeof formula === "number") {
    if (!Number.isFinite(formula)) {
      throw new FormulaEvaluationError("Formula is not finite");
    }
    return formula;
  }
  const source = `${formula}`.trim();
  if (!source) throw new FormulaSyntaxError("Formula cannot be empty");
  const ast = parseFormulaExpression(source);
  const out = evaluateAst(ast, variables);
  if (!Number.isFinite(out)) throw new FormulaEvaluationError("Result is not finite");
  return out;
}

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  return { x, y, width, height };
}

function createRootVariables(rect) {
  return {
    $W: rect.width,
    $H: rect.height,
    $D: 450,
    $T: 20,
  };
}

function resolveDimensionSet(formulas, variables) {
  const out = {};
  ["W", "H", "D", "T"].forEach((k) => {
    if (formulas[k] === undefined) return;
    out[k] = evaluateFormula(formulas[k], variables);
  });
  return out;
}

function resolvePartDimensions(part, rootVars) {
  const finish = resolveDimensionSet(part.finishFormulas, rootVars);
  const margin = resolveDimensionSet(part.marginFormulas, rootVars);
  return {
    finish,
    margin,
    order: {
      W: (finish.W ?? 0) + (margin.W ?? 0),
      H: (finish.H ?? 0) + (margin.H ?? 0),
      D: (finish.D ?? 0) + (margin.D ?? 0),
      T: (finish.T ?? 0) + (margin.T ?? 0),
    },
  };
}

function snapCandidates() {
  const x = [];
  const y = [];
  boards.forEach((board) => {
    const nx = board.node.x();
    const ny = board.node.y();
    const w = board.node.width() * board.node.scaleX();
    const h = board.node.height() * board.node.scaleY();
    x.push(
      { value: nx, expr: board.positionFormulas.x || `${Math.round(nx)}` },
      { value: nx + w, expr: `(${board.positionFormulas.x || Math.round(nx)}) + ${Math.round(w)}` },
      { value: nx + w / 2, expr: `(${board.positionFormulas.x || Math.round(nx)}) + ${Math.round(w / 2)}` },
      { value: nx + w / 3, expr: `(${board.positionFormulas.x || Math.round(nx)}) + ${Math.round(w / 3)}` },
      { value: nx + (2 * w) / 3, expr: `(${board.positionFormulas.x || Math.round(nx)}) + ${Math.round((2 * w) / 3)}` }
    );
    y.push(
      { value: ny, expr: board.positionFormulas.y || `${Math.round(ny)}` },
      { value: ny + h, expr: `(${board.positionFormulas.y || Math.round(ny)}) + ${Math.round(h)}` },
      { value: ny + h / 2, expr: `(${board.positionFormulas.y || Math.round(ny)}) + ${Math.round(h / 2)}` },
      { value: ny + h / 3, expr: `(${board.positionFormulas.y || Math.round(ny)}) + ${Math.round(h / 3)}` },
      { value: ny + (2 * h) / 3, expr: `(${board.positionFormulas.y || Math.round(ny)}) + ${Math.round((2 * h) / 3)}` }
    );
  });
  x.push(
    { value: 0, expr: "0" },
    { value: stage.width() / 2, expr: "$CANVAS_W / 2" },
    { value: stage.width() / 3, expr: "$CANVAS_W / 3" },
    { value: (stage.width() * 2) / 3, expr: "($CANVAS_W * 2) / 3" },
    { value: stage.width(), expr: "$CANVAS_W" }
  );
  y.push(
    { value: 0, expr: "0" },
    { value: stage.height() / 2, expr: "$CANVAS_H / 2" },
    { value: stage.height() / 3, expr: "$CANVAS_H / 3" },
    { value: (stage.height() * 2) / 3, expr: "($CANVAS_H * 2) / 3" },
    { value: stage.height(), expr: "$CANVAS_H" }
  );
  return { x, y };
}

function snapPoint(point) {
  const candidates = snapCandidates();
  const snapped = {
    ...point,
    snappedX: false,
    snappedY: false,
    refXValue: point.x,
    refYValue: point.y,
    refXExpr: `${Math.round(point.x)}`,
    refYExpr: `${Math.round(point.y)}`,
  };

  let bestX = null;
  candidates.x.forEach((candidate) => {
    const distance = Math.abs(point.x - candidate.value);
    if (distance > SNAP_DISTANCE) return;
    if (!bestX || distance < bestX.distance) {
      bestX = { ...candidate, distance };
    }
  });
  if (bestX) {
    snapped.x = bestX.value;
    snapped.snappedX = true;
    snapped.refXValue = bestX.value;
    snapped.refXExpr = bestX.expr;
  }

  let bestY = null;
  candidates.y.forEach((candidate) => {
    const distance = Math.abs(point.y - candidate.value);
    if (distance > SNAP_DISTANCE) return;
    if (!bestY || distance < bestY.distance) {
      bestY = { ...candidate, distance };
    }
  });
  if (bestY) {
    snapped.y = bestY.value;
    snapped.snappedY = true;
    snapped.refYValue = bestY.value;
    snapped.refYExpr = bestY.expr;
  }

  return snapped;
}

function toRelativeFormula(value, referenceValue, referenceExpr) {
  const delta = value - referenceValue;
  if (Math.abs(delta) < 0.0001) return `${referenceExpr}`;
  if (delta > 0) return `(${referenceExpr}) + ${Math.round(delta)}`;
  return `(${referenceExpr}) - ${Math.round(Math.abs(delta))}`;
}

function dimsLabel(width, height) {
  return `${Math.round(width)} x ${Math.round(height)} mm`;
}

function detectRole(rect) {
  return rect.height >= rect.width ? "vertical-member" : "horizontal-member";
}

function createBoardNode(rect, role) {
  const node = new Konva.Rect({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    fill: role === "vertical-member" ? "rgba(37,99,235,0.18)" : "rgba(22,163,74,0.18)",
    stroke: role === "vertical-member" ? "#1d4ed8" : "#15803d",
    strokeWidth: 2,
    draggable: true,
    cornerRadius: 3,
    name: "board",
  });
  node.on("click tap", () => selectBoard(node));
  node.on("dragstart", () => {
    lastHudOperation = "move";
    refreshHud();
  });
  node.on("dragmove", () => {
    const pos = snapPoint({ x: node.x(), y: node.y() });
    node.position({ x: pos.x, y: pos.y });
    syncBoardFromNode(node);
    refreshHud();
    layer.batchDraw();
  });
  node.on("transformend", () => {
    lastHudOperation = "resize";
    node.width(Math.max(MIN_DRAW_SIZE, node.width() * node.scaleX()));
    node.height(Math.max(MIN_DRAW_SIZE, node.height() * node.scaleY()));
    node.scale({ x: 1, y: 1 });
    syncBoardFromNode(node);
    refreshHud();
    layer.batchDraw();
  });
  return node;
}

function createBoardData(node, rect, role, startSnap, endSnap) {
  const rootVars = createRootVariables(rect);
  const part = {
    id: `part-${boardCounter}`,
    role,
    matId: role === "vertical-member" ? "ply18-v" : "ply18-h",
    drawingNo: `${DRAWING_NO_PREFIX}${String(boardCounter).padStart(4, "0")}`,
    parentId: "component-root-1",
    finishFormulas: {
      W: role === "vertical-member" ? "$T" : "$W",
      H: role === "vertical-member" ? "$H" : "$T",
      D: "$D",
    },
    marginFormulas: {
      W: `${DEFAULT_MARGIN_MM}`,
      H: `${DEFAULT_MARGIN_MM}`,
      D: `${DEFAULT_MARGIN_MM}`,
    },
    positionFormulas: {
      x: startSnap.snappedX
        ? toRelativeFormula(rect.x, startSnap.refXValue, startSnap.refXExpr)
        : `${Math.round(rect.x)}`,
      y: startSnap.snappedY
        ? toRelativeFormula(rect.y, startSnap.refYValue, startSnap.refYExpr)
        : `${Math.round(rect.y)}`,
      w:
        startSnap.snappedX && endSnap.snappedX
          ? `(${endSnap.refXExpr}) - (${startSnap.refXExpr})`
          : `${Math.round(rect.width)}`,
      h:
        startSnap.snappedY && endSnap.snappedY
          ? `(${endSnap.refYExpr}) - (${startSnap.refYExpr})`
          : `${Math.round(rect.height)}`,
    },
    rootVars,
    node,
  };
  boardCounter += 1;
  return part;
}

function syncBoardFromNode(node) {
  const board = boards.find((item) => item.node === node);
  if (!board) return;
  const rect = {
    x: node.x(),
    y: node.y(),
    width: node.width(),
    height: node.height(),
  };
  board.rootVars = createRootVariables(rect);
  board.positionFormulas = {
    x: `${Math.round(rect.x)}`,
    y: `${Math.round(rect.y)}`,
    w: `${Math.round(rect.width)}`,
    h: `${Math.round(rect.height)}`,
  };
  updatePartsList();
}

function selectBoard(node) {
  selectedNode = node;
  lastHudOperation = "move";
  tr.nodes([node]);
  refreshHud();
  layer.batchDraw();
}

function updatePartsList() {
  if (boards.length === 0) {
    partsListEl.innerHTML = `<div class="empty">まだ部材がありません。左のキャンバスで矩形を描画してください。</div>`;
    return;
  }
  partsListEl.innerHTML = boards
    .map((board) => {
      const dims = resolvePartDimensions(board, board.rootVars);
      return `
        <article class="part-card">
          <h3 class="part-title">${board.role} / ${board.drawingNo}</h3>
          <div class="row"><span>matId</span><strong>${board.matId}</strong></div>
          <div class="row"><span>仕上がり寸法</span><strong>${dimsLabel(dims.finish.W ?? 0, dims.finish.H ?? 0)}</strong></div>
          <div class="row"><span>伸び寸法</span><strong>+${DEFAULT_MARGIN_MM} mm</strong></div>
          <div class="row"><span>発注寸法</span><strong>${dimsLabel(dims.order.W ?? 0, dims.order.H ?? 0)}</strong></div>
          <div class="row"><span>座標数式</span><strong>x:${board.positionFormulas.x} / y:${board.positionFormulas.y}</strong></div>
        </article>
      `;
    })
    .join("");
}

function refreshHud() {
  if (!selectedNode) {
    hudStateEl.innerHTML = "<br />選択なし";
    return;
  }
  hudStateEl.innerHTML = `<br />選択中: ${Math.round(selectedNode.x())}, ${Math.round(selectedNode.y())} / ${Math.round(
    selectedNode.width()
  )}x${Math.round(selectedNode.height())} mm<br />モード: <code>${lastHudOperation}</code><br />入力バッファ: <code>${
    keyBuffer.text || "(empty)"
  }</code>`;
}

function beginDraw(event) {
  if (event.target && event.target !== stage) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  isDrawing = true;
  startPoint = snapPoint(pointer);
  snappedStartPoint = startPoint;
  currentRect = null;
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
  if (!isDrawing || !startPoint) return;
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const snapped = snapPoint(pointer);
  currentRect = normalizeRect(startPoint, snapped);
  draftRect.position({ x: currentRect.x, y: currentRect.y });
  draftRect.size({ width: currentRect.width, height: currentRect.height });
  draftText.position({ x: currentRect.x + 2, y: currentRect.y - 18 });
  draftText.text(`W ${Math.round(currentRect.width)} / H ${Math.round(currentRect.height)}`);
  layer.batchDraw();
}

function endDraw() {
  if (!isDrawing) return;
  isDrawing = false;
  if (!currentRect || currentRect.width < MIN_DRAW_SIZE || currentRect.height < MIN_DRAW_SIZE) {
    if (draftRect) {
      draftRect.size({ width: 0, height: 0 });
      draftText.text("");
      layer.batchDraw();
    }
    return;
  }
  const role = detectRole(currentRect);
  const node = createBoardNode(currentRect, role);
  layer.add(node);
  const endSnap = snapPoint({ x: currentRect.x + currentRect.width, y: currentRect.y + currentRect.height });
  const board = createBoardData(node, currentRect, role, snappedStartPoint, endSnap);
  boards.push(board);
  selectBoard(node);
  updatePartsList();
  draftRect.size({ width: 0, height: 0 });
  draftText.text("");
  layer.draw();
}

function parseRelativeInput(text) {
  const trimmed = text.trim();
  if (!/^[+-]\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

function applyRelativeDelta(delta) {
  if (!selectedNode) return;
  if (lastHudOperation === "resize") {
    const nextW = Math.max(MIN_DRAW_SIZE, selectedNode.width() + delta);
    const nextH = Math.max(MIN_DRAW_SIZE, selectedNode.height() + delta);
    selectedNode.size({ width: nextW, height: nextH });
  } else {
    selectedNode.position({
      x: selectedNode.x() + delta,
      y: selectedNode.y() + delta,
    });
  }
  syncBoardFromNode(selectedNode);
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
    if (delta !== null) {
      applyRelativeDelta(delta);
    }
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
    if (event.target === stage) {
      selectedNode = null;
      lastHudOperation = "move";
      tr.nodes([]);
      refreshHud();
      layer.batchDraw();
    }
  });
  window.addEventListener("keydown", handleKeyboardInput);
  window.addEventListener("resize", () => {
    stage.width(stageContainer.clientWidth);
    stage.height(stageContainer.clientHeight);
    layer.batchDraw();
  });
  refreshHud();
}

initStage();
