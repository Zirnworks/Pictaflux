import type { BlendMode } from "./types";

let nextId = 1;

export class Layer {
  id: number;
  name = $state("");
  visible = $state(true);
  opacity = $state(1.0);
  blendMode: BlendMode = $state("source-over");
  thumbnailUrl = $state("");

  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;

  constructor(name: string, width: number, height: number) {
    this.id = nextId++;
    this.name = name;
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext("2d")!;
  }

  resize(width: number, height: number, fillColor?: string) {
    const oldW = this.canvas.width;
    const oldH = this.canvas.height;
    const oldData =
      oldW > 0 && oldH > 0
        ? this.ctx.getImageData(0, 0, oldW, oldH)
        : null;

    this.canvas.width = width;
    this.canvas.height = height;

    if (fillColor) {
      this.ctx.fillStyle = fillColor;
      this.ctx.fillRect(0, 0, width, height);
    }

    if (oldData) {
      this.ctx.putImageData(oldData, 0, 0);
    }
  }

  async updateThumbnail(size: number = 48) {
    const thumb = new OffscreenCanvas(size, size);
    const tctx = thumb.getContext("2d")!;
    tctx.drawImage(
      this.canvas,
      0, 0, this.canvas.width, this.canvas.height,
      0, 0, size, size,
    );
    const blob = await thumb.convertToBlob({ type: "image/png" });
    const oldUrl = this.thumbnailUrl;
    this.thumbnailUrl = URL.createObjectURL(blob);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }

  dispose() {
    if (this.thumbnailUrl) {
      URL.revokeObjectURL(this.thumbnailUrl);
      this.thumbnailUrl = "";
    }
  }
}

export class LayerManager {
  layers: Layer[] = $state([]);
  activeLayerId = $state(0);
  bgColor = $state("#1e1e1e");
  bgVisible = $state(true);

  get activeLayer(): Layer | undefined {
    return this.layers.find((l) => l.id === this.activeLayerId);
  }

  init(physW: number, physH: number) {
    for (const l of this.layers) l.dispose();

    const bg = new Layer("Layer 1", physW, physH);

    this.layers = [bg];
    this.activeLayerId = bg.id;
  }

  addLayer(name?: string) {
    const physW = this.layers[0]?.canvas.width ?? 1;
    const physH = this.layers[0]?.canvas.height ?? 1;
    const newName = name ?? `Layer ${this.layers.length + 1}`;
    const layer = new Layer(newName, physW, physH);

    const activeIdx = this.layers.findIndex(
      (l) => l.id === this.activeLayerId,
    );
    const insertAt = activeIdx >= 0 ? activeIdx + 1 : this.layers.length;
    this.layers.splice(insertAt, 0, layer);
    this.layers = [...this.layers];
    this.activeLayerId = layer.id;
  }

  deleteLayer(id: number) {
    if (this.layers.length <= 1) return;
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1) return;

    this.layers[idx].dispose();
    this.layers.splice(idx, 1);

    if (this.activeLayerId === id) {
      const newIdx = Math.min(idx, this.layers.length - 1);
      this.activeLayerId = this.layers[newIdx].id;
    }

    this.layers = [...this.layers];
  }

  duplicateLayer(id: number) {
    const src = this.layers.find((l) => l.id === id);
    if (!src) return;

    const dup = new Layer(
      `${src.name} copy`,
      src.canvas.width,
      src.canvas.height,
    );
    dup.visible = src.visible;
    dup.opacity = src.opacity;
    dup.blendMode = src.blendMode;
    dup.ctx.drawImage(src.canvas, 0, 0);

    const idx = this.layers.findIndex((l) => l.id === id);
    this.layers.splice(idx + 1, 0, dup);
    this.layers = [...this.layers];
    this.activeLayerId = dup.id;
  }

  reorderLayer(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    if (fromIdx < 0 || toIdx < 0) return;
    if (fromIdx >= this.layers.length || toIdx >= this.layers.length) return;
    const [layer] = this.layers.splice(fromIdx, 1);
    this.layers.splice(toIdx, 0, layer);
    this.layers = [...this.layers];
  }

  moveLayerUp(id: number) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx >= 0 && idx < this.layers.length - 1) {
      this.reorderLayer(idx, idx + 1);
    }
  }

  moveLayerDown(id: number) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx > 0) {
      this.reorderLayer(idx, idx - 1);
    }
  }

  renameLayer(id: number, name: string) {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.name = name;
  }

  setLayerVisibility(id: number, visible: boolean) {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.visible = visible;
  }

  setLayerOpacity(id: number, opacity: number) {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.opacity = Math.max(0, Math.min(1, opacity));
  }

  setLayerBlendMode(id: number, blendMode: BlendMode) {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.blendMode = blendMode;
  }

  mergeDown(id: number) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return;

    const upper = this.layers[idx];
    const lower = this.layers[idx - 1];

    if (upper.visible) {
      lower.ctx.globalAlpha = upper.opacity;
      lower.ctx.globalCompositeOperation = upper.blendMode;
      lower.ctx.drawImage(upper.canvas, 0, 0);
      lower.ctx.globalAlpha = 1.0;
      lower.ctx.globalCompositeOperation = "source-over";
    }

    upper.dispose();
    this.layers.splice(idx, 1);
    this.layers = [...this.layers];
    this.activeLayerId = lower.id;
  }

  flatten() {
    const physW = this.layers[0]?.canvas.width ?? 1;
    const physH = this.layers[0]?.canvas.height ?? 1;

    const flat = new Layer("Background", physW, physH);
    this.compositeToContext(flat.ctx);

    for (const l of this.layers) l.dispose();
    this.layers = [flat];
    this.activeLayerId = flat.id;
  }

  compositeToContext(
    target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ) {
    const w = target.canvas.width;
    const h = target.canvas.height;
    target.clearRect(0, 0, w, h);

    if (this.bgVisible) {
      target.globalAlpha = 1.0;
      target.globalCompositeOperation = "source-over";
      target.fillStyle = this.bgColor;
      target.fillRect(0, 0, w, h);
    }

    for (const layer of this.layers) {
      if (!layer.visible) continue;
      target.globalAlpha = layer.opacity;
      target.globalCompositeOperation = layer.blendMode;
      target.drawImage(layer.canvas, 0, 0);
    }

    target.globalAlpha = 1.0;
    target.globalCompositeOperation = "source-over";
  }

  resizeAll(physW: number, physH: number) {
    for (const layer of this.layers) {
      layer.resize(physW, physH);
    }
  }

  clearActiveLayer() {
    const layer = this.activeLayer;
    if (!layer) return;
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  }

  fillActiveLayer(color: string) {
    const layer = this.activeLayer;
    if (!layer) return;
    layer.ctx.fillStyle = color;
    layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  }

  updateActiveLayerThumbnail() {
    this.activeLayer?.updateThumbnail();
  }

  dispose() {
    for (const l of this.layers) l.dispose();
    this.layers = [];
  }
}
