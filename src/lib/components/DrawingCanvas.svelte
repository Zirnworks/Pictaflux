<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import type { LayerManager } from "../layers.svelte";
  import type { BrushEngine } from "../brush-engine";

  let {
    brushSize = 8,
    brushColor = $bindable("#ffffff"),
    brushOpacity = 1.0,
    brushEngine,
    layerManager,
  }: {
    brushSize: number;
    brushColor: string;
    brushOpacity: number;
    brushEngine: BrushEngine;
    layerManager: LayerManager;
  } = $props();

  let canvasEl: HTMLCanvasElement;
  let displayCtx: CanvasRenderingContext2D | null = null;
  let drawing = $state(false);
  let eyedropping = $state(false);
  let containerEl: HTMLElement;
  let dpr = 1;

  // Native tablet pressure from Rust NSEvent monitor (bypasses WKWebView limitation)
  let nativeTablet = { pressure: -1, tiltX: 0, tiltY: 0, ts: 0 };

  // Debug: show pen input state
  let debugInfo = $state({ pressure: 0, pointerType: "", tiltX: 0, tiltY: 0, native: false });

  // Sync brush params to engine (read into locals — Svelte 5 gotcha)
  $effect(() => {
    const s = brushSize;
    const c = brushColor;
    const o = brushOpacity;
    brushEngine.setSize(s);
    brushEngine.setColor(c);
    brushEngine.setOpacity(o);
  });

  onMount(() => {
    displayCtx = canvasEl.getContext("2d", { willReadFrequently: true });
    if (!displayCtx) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(containerEl);

    // Listen for native tablet pressure from Rust NSEvent monitor
    let unlistenTablet: (() => void) | undefined;
    listen<{ pressure: number; tilt_x: number; tilt_y: number }>(
      "native-tablet",
      (event) => {
        nativeTablet.pressure = event.payload.pressure;
        nativeTablet.tiltX = event.payload.tilt_x;
        nativeTablet.tiltY = event.payload.tilt_y;
        nativeTablet.ts = Date.now();
      },
    ).then((fn) => (unlistenTablet = fn));

    return () => {
      observer.disconnect();
      unlistenTablet?.();
    };
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

    brushEngine.setDpr(dpr);

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

  // Recomposite when layer properties or background changes
  $effect(() => {
    layerManager.bgColor;
    layerManager.bgVisible;
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

  function getPressure(e: PointerEvent): { pressure: number; tiltX: number; tiltY: number } {
    // Use native NSEvent pressure if available (< 200ms old)
    const useNative = nativeTablet.pressure >= 0 && Date.now() - nativeTablet.ts < 200;
    if (useNative) {
      return {
        pressure: nativeTablet.pressure,
        tiltX: nativeTablet.tiltX,
        tiltY: nativeTablet.tiltY,
      };
    }
    // Fallback to PointerEvent values
    return {
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      tiltX: e.tiltX ?? 0,
      tiltY: e.tiltY ?? 0,
    };
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
    const layer = layerManager.activeLayer;
    if (!layer) return;

    const pen = getPressure(e);
    brushEngine.beginStroke(
      layer.ctx,
      pos.x,
      pos.y,
      pen.pressure,
      pen.tiltX,
      pen.tiltY,
    );
    compositeToDisplay();
  }

  function onPointerMove(e: PointerEvent) {
    const pen = getPressure(e);
    const useNative = nativeTablet.pressure >= 0 && Date.now() - nativeTablet.ts < 200;

    // Debug: always update pen info
    debugInfo = {
      pressure: pen.pressure,
      pointerType: e.pointerType,
      tiltX: pen.tiltX,
      tiltY: pen.tiltY,
      native: useNative,
    };

    if (eyedropping) {
      pickColor(e);
      return;
    }
    if (!drawing) return;

    const pos = getPosition(e);
    const layer = layerManager.activeLayer;
    if (!layer) return;

    brushEngine.addPoint(
      layer.ctx,
      pos.x,
      pos.y,
      pen.pressure,
      pen.tiltX,
      pen.tiltY,
    );
    compositeToDisplay();
  }

  function onPointerUp() {
    if (drawing) {
      brushEngine.endStroke();
      layerManager.updateActiveLayerThumbnail();
    }
    drawing = false;
    eyedropping = false;
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

      const composite = new OffscreenCanvas(physW, physH);
      const cctx = composite.getContext("2d");
      if (!cctx) {
        resolve(null);
        return;
      }
      layerManager.compositeToContext(cctx);

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
  <div class="debug-overlay">
    {debugInfo.pointerType}{debugInfo.native ? " (native)" : ""} | pressure: {debugInfo.pressure.toFixed(3)} | tilt: {debugInfo.tiltX.toFixed(1)},{debugInfo.tiltY.toFixed(1)}
  </div>
</div>

<style>
  .canvas-container {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    background: var(--canvas-bg);
    position: relative;
  }

  canvas {
    display: block;
    cursor: crosshair;
    touch-action: none;
  }

  canvas.eyedropper {
    cursor: copy;
  }

  .debug-overlay {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.7);
    color: #0f0;
    font-family: monospace;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    pointer-events: none;
    z-index: 10;
  }
</style>
