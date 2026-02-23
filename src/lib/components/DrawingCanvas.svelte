<script lang="ts">
  import { onMount } from "svelte";

  let {
    brushSize = 8,
    brushColor = $bindable("#ffffff"),
    brushOpacity = 1.0,
  }: {
    brushSize: number;
    brushColor: string;
    brushOpacity: number;
  } = $props();

  let canvasEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let drawing = $state(false);
  let eyedropping = $state(false);
  let lastX = 0;
  let lastY = 0;
  let containerEl: HTMLElement;

  onMount(() => {
    ctx = canvasEl.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(containerEl);

    return () => observer.disconnect();
  });

  function resizeCanvas() {
    if (!ctx || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const imageData =
      canvasEl.width > 0 && canvasEl.height > 0
        ? ctx.getImageData(0, 0, canvasEl.width, canvasEl.height)
        : null;

    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    canvasEl.style.width = `${rect.width}px`;
    canvasEl.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (imageData) {
      ctx.putImageData(imageData, 0, 0);
    }
  }

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
  }

  function onPointerMove(e: PointerEvent) {
    if (eyedropping) {
      pickColor(e);
      return;
    }
    if (!drawing || !ctx) return;

    const pos = getPosition(e);
    const pressure = getPressure(e);
    drawStroke(lastX, lastY, pos.x, pos.y, pressure);
    lastX = pos.x;
    lastY = pos.y;
  }

  function onPointerUp() {
    drawing = false;
    eyedropping = false;
  }

  function drawDot(x: number, y: number, pressure: number) {
    if (!ctx) return;
    const radius = (brushSize / 2) * pressure;
    ctx.globalAlpha = brushOpacity * pressure;
    ctx.fillStyle = brushColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
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
    if (!ctx) return;
    const lineWidth = brushSize * pressure;
    ctx.globalAlpha = brushOpacity * pressure;
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  function pickColor(e: PointerEvent) {
    if (!ctx) return;
    const pos = getPosition(e);
    const dpr = window.devicePixelRatio || 1;
    const pixel = ctx.getImageData(
      pos.x * dpr,
      pos.y * dpr,
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
    if (!ctx || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }

  export function getImageData(): ImageData | null {
    if (!ctx) return null;
    return ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
  }

  export function toBlob(
    quality: number = 0.80,
    targetSize: number = 512,
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!canvasEl) {
        resolve(null);
        return;
      }
      const offscreen = new OffscreenCanvas(targetSize, targetSize);
      const octx = offscreen.getContext("2d");
      if (!octx) {
        resolve(null);
        return;
      }
      const srcW = canvasEl.width;
      const srcH = canvasEl.height;
      const srcMin = Math.min(srcW, srcH);
      const sx = (srcW - srcMin) / 2;
      const sy = (srcH - srcMin) / 2;
      octx.drawImage(canvasEl, sx, sy, srcMin, srcMin, 0, 0, targetSize, targetSize);
      offscreen
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
    width: 100%;
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
