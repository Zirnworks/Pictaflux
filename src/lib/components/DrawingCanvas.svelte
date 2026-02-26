<script lang="ts">
  import { onMount } from "svelte";
  import type { LayerManager } from "../layers.svelte";

  let {
    brushSize = 8,
    brushColor = $bindable("#ffffff"),
    brushOpacity = 1.0,
    layerManager,
  }: {
    brushSize: number;
    brushColor: string;
    brushOpacity: number;
    layerManager: LayerManager;
  } = $props();

  let canvasEl: HTMLCanvasElement;
  let displayCtx: CanvasRenderingContext2D | null = null;
  let drawing = $state(false);
  let eyedropping = $state(false);
  let lastX = 0;
  let lastY = 0;
  let containerEl: HTMLElement;
  let dpr = 1;

  onMount(() => {
    displayCtx = canvasEl.getContext("2d", { willReadFrequently: true });
    if (!displayCtx) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(containerEl);

    return () => observer.disconnect();
  });

  function resizeCanvas() {
    if (!displayCtx || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;

    const physW = Math.round(rect.width * dpr);
    const physH = Math.round(rect.height * dpr);

    canvasEl.width = physW;
    canvasEl.height = physH;
    canvasEl.style.width = `${rect.width}px`;
    canvasEl.style.height = `${rect.height}px`;

    if (layerManager.layers.length === 0) {
      layerManager.init(physW, physH);
    } else {
      layerManager.resizeAll(physW, physH);
    }

    compositeToDisplay();
  }

  function compositeToDisplay() {
    if (!displayCtx) return;
    displayCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerManager.compositeToContext(displayCtx);
  }

  // Recomposite when layer visibility/opacity/blendMode changes
  $effect(() => {
    for (const l of layerManager.layers) {
      l.visible;
      l.opacity;
      l.blendMode;
    }
    compositeToDisplay();
  });

  function getPosition(e: PointerEvent): { x: number; y: number } {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function getPressure(e: PointerEvent): number {
    return e.pressure > 0 ? e.pressure : 0.5;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    canvasEl.setPointerCapture(e.pointerId);

    if (e.altKey) {
      eyedropping = true;
      pickColor(e);
      return;
    }

    drawing = true;
    const pos = getPosition(e);
    lastX = pos.x;
    lastY = pos.y;
    drawDot(pos.x, pos.y, getPressure(e));
    compositeToDisplay();
  }

  function onPointerMove(e: PointerEvent) {
    if (eyedropping) {
      pickColor(e);
      return;
    }
    if (!drawing) return;

    const pos = getPosition(e);
    const pressure = getPressure(e);
    drawStroke(lastX, lastY, pos.x, pos.y, pressure);
    lastX = pos.x;
    lastY = pos.y;
    compositeToDisplay();
  }

  function onPointerUp() {
    if (drawing) {
      layerManager.updateActiveLayerThumbnail();
    }
    drawing = false;
    eyedropping = false;
  }

  function drawDot(x: number, y: number, pressure: number) {
    const layer = layerManager.activeLayer;
    if (!layer) return;
    const ctx = layer.ctx;

    const px = x * dpr;
    const py = y * dpr;
    const radius = (brushSize / 2) * pressure * dpr;

    ctx.globalAlpha = brushOpacity * pressure;
    ctx.fillStyle = brushColor;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  function drawStroke(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    pressure: number,
  ) {
    const layer = layerManager.activeLayer;
    if (!layer) return;
    const ctx = layer.ctx;

    const lineWidth = brushSize * pressure * dpr;
    ctx.globalAlpha = brushOpacity * pressure;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fromX * dpr, fromY * dpr);
    ctx.lineTo(toX * dpr, toY * dpr);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  function pickColor(e: PointerEvent) {
    if (!displayCtx) return;
    const pos = getPosition(e);
    const pixel = displayCtx.getImageData(
      Math.round(pos.x * dpr),
      Math.round(pos.y * dpr),
      1,
      1,
    ).data;
    const hex = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
    brushColor = hex;
  }

  function onContextMenu(e: Event) {
    e.preventDefault();
  }

  export function toDataURL(): string {
    return canvasEl.toDataURL("image/png");
  }

  export function clear() {
    layerManager.clearActiveLayer();
    compositeToDisplay();
  }

  export function getImageData(): ImageData | null {
    if (!displayCtx) return null;
    return displayCtx.getImageData(0, 0, canvasEl.width, canvasEl.height);
  }

  export function toBlob(
    quality: number = 0.80,
    targetSize: number = 512,
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!canvasEl || layerManager.layers.length === 0) {
        resolve(null);
        return;
      }

      const physW = canvasEl.width;
      const physH = canvasEl.height;

      // Composite all layers to a temp canvas at physical size
      const composite = new OffscreenCanvas(physW, physH);
      const cctx = composite.getContext("2d");
      if (!cctx) {
        resolve(null);
        return;
      }
      layerManager.compositeToContext(cctx);

      // Crop center square + scale to targetSize
      const out = new OffscreenCanvas(targetSize, targetSize);
      const octx = out.getContext("2d");
      if (!octx) {
        resolve(null);
        return;
      }
      const srcMin = Math.min(physW, physH);
      const sx = (physW - srcMin) / 2;
      const sy = (physH - srcMin) / 2;
      octx.drawImage(
        composite,
        sx, sy, srcMin, srcMin,
        0, 0, targetSize, targetSize,
      );

      out
        .convertToBlob({ type: "image/jpeg", quality })
        .then(resolve)
        .catch(() => resolve(null));
    });
  }
</script>

<div class="canvas-container" bind:this={containerEl}>
  <canvas
    bind:this={canvasEl}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={onPointerUp}
    oncontextmenu={onContextMenu}
    class:eyedropper={eyedropping}
  ></canvas>
</div>

<style>
  .canvas-container {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    background: var(--canvas-bg);
  }

  canvas {
    display: block;
    cursor: crosshair;
    touch-action: none;
  }

  canvas.eyedropper {
    cursor: copy;
  }
</style>
