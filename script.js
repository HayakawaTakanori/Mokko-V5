const SIDE_THICKNESS_MM = 18;
const DEFAULT_MARGIN_MM = 10;
const MIN_DRAW_SIZE = 20;

const stageContainer = document.getElementById("stage-container");
const partsListEl = document.getElementById("parts-list");

let stage;
let layer;
let isDrawing = false;
let startPoint = null;
let draftGroup = null;
let finalGroup = null;
let currentRect = null;

function initStage() {
  stage = new Konva.Stage({
    container: "stage-container",
    width: stageContainer.clientWidth,
    height: stageContainer.clientHeight,
  });

  layer = new Konva.Layer();
  stage.add(layer);

  stage.on("mousedown touchstart", beginDraw);
  stage.on("mousemove touchmove", continueDraw);
  stage.on("mouseup touchend", endDraw);

  window.addEventListener("resize", resizeStage);
}

function resizeStage() {
  stage.width(stageContainer.clientWidth);
  stage.height(stageContainer.clientHeight);
  layer.batchDraw();
}

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  return { x, y, width, height };
}

function createFurnitureGroup(rect, isPreview = false) {
  const group = new Konva.Group({
    x: rect.x,
    y: rect.y,
    listening: false,
  });

  const outer = new Konva.Rect({
    x: 0,
    y: 0,
    width: rect.width,
    height: rect.height,
    stroke: "#1f2937",
    strokeWidth: 2,
    fill: isPreview ? "rgba(37, 99, 235, 0.04)" : "rgba(17, 24, 39, 0.02)",
    dash: isPreview ? [6, 5] : [],
  });

  const sideWidth = Math.min(SIDE_THICKNESS_MM, rect.width / 2);
  const leftSide = new Konva.Rect({
    x: 0,
    y: 0,
    width: sideWidth,
    height: rect.height,
    fill: "rgba(37, 99, 235, 0.22)",
    stroke: "#2563eb",
    strokeWidth: 1,
  });

  const rightSide = new Konva.Rect({
    x: rect.width - sideWidth,
    y: 0,
    width: sideWidth,
    height: rect.height,
    fill: "rgba(37, 99, 235, 0.22)",
    stroke: "#2563eb",
    strokeWidth: 1,
  });

  const dimensionText = new Konva.Text({
    x: 4,
    y: -24,
    text: `W ${Math.round(rect.width)}mm / H ${Math.round(rect.height)}mm`,
    fontFamily: "Arial",
    fontSize: 14,
    fontStyle: "bold",
    fill: "#1d4ed8",
  });

  group.add(outer);
  group.add(leftSide);
  group.add(rightSide);
  group.add(dimensionText);
  return group;
}

function beginDraw() {
  const point = stage.getPointerPosition();
  if (!point) return;

  isDrawing = true;
  startPoint = point;
  currentRect = null;

  if (draftGroup) {
    draftGroup.destroy();
  }

  draftGroup = createFurnitureGroup({ x: point.x, y: point.y, width: 0, height: 0 }, true);
  layer.add(draftGroup);
  layer.draw();
}

function continueDraw() {
  if (!isDrawing || !startPoint || !draftGroup) return;
  const point = stage.getPointerPosition();
  if (!point) return;

  currentRect = normalizeRect(startPoint, point);
  draftGroup.destroy();
  draftGroup = createFurnitureGroup(currentRect, true);
  layer.add(draftGroup);
  layer.batchDraw();
}

function endDraw() {
  if (!isDrawing) return;
  isDrawing = false;

  if (!currentRect || currentRect.width < MIN_DRAW_SIZE || currentRect.height < MIN_DRAW_SIZE) {
    if (draftGroup) {
      draftGroup.destroy();
      draftGroup = null;
      layer.draw();
    }
    return;
  }

  if (draftGroup) {
    draftGroup.destroy();
    draftGroup = null;
  }
  if (finalGroup) {
    finalGroup.destroy();
  }

  finalGroup = createFurnitureGroup(currentRect, false);
  layer.add(finalGroup);
  layer.draw();

  updatePartsList(currentRect);
}

function dimsLabel(width, height) {
  return `${Math.round(width)} x ${Math.round(height)} mm`;
}

function updatePartsList(rect) {
  const sideWidth = Math.min(SIDE_THICKNESS_MM, rect.width / 2);
  const finishWidth = sideWidth;
  const finishHeight = rect.height;
  const orderWidth = finishWidth + DEFAULT_MARGIN_MM;
  const orderHeight = finishHeight + DEFAULT_MARGIN_MM;

  const parts = [
    { name: "左側板", finishWidth, finishHeight, orderWidth, orderHeight },
    { name: "右側板", finishWidth, finishHeight, orderWidth, orderHeight },
  ];

  partsListEl.innerHTML = parts
    .map(
      (part) => `
        <article class="part-card">
          <h3 class="part-title">${part.name}</h3>
          <div class="row"><span>仕上がり寸法</span><strong>${dimsLabel(part.finishWidth, part.finishHeight)}</strong></div>
          <div class="row"><span>伸び</span><strong>+${DEFAULT_MARGIN_MM} mm</strong></div>
          <div class="row"><span>発注寸法</span><strong>${dimsLabel(part.orderWidth, part.orderHeight)}</strong></div>
        </article>
      `
    )
    .join("");
}

initStage();
