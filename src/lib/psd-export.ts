import { writePsd, type Psd, type Layer as PsdLayer, type BlendMode as PsdBlendMode } from "ag-psd";
import type { LayerManager } from "./layers.svelte";
import type { BlendMode } from "./types";

const BLEND_MAP: Record<BlendMode, PsdBlendMode> = {
  "source-over": "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
};

export function buildPsd(layerManager: LayerManager): Uint8Array {
  const first = layerManager.layers[0];
  if (!first) throw new Error("No layers to export");

  const w = first.canvas.width;
  const h = first.canvas.height;

  const children: PsdLayer[] = [];

  for (const layer of layerManager.layers) {
    children.push({
      name: layer.name,
      canvas: layer.canvas as any,
      top: 0,
      left: 0,
      bottom: h,
      right: w,
      opacity: layer.opacity,
      blendMode: BLEND_MAP[layer.blendMode] ?? "normal",
      hidden: !layer.visible,
    });
  }

  // Generate composite
  const composite = new OffscreenCanvas(w, h);
  const cctx = composite.getContext("2d")!;
  layerManager.compositeToContext(cctx);

  const psd: Psd = {
    width: w,
    height: h,
    children,
    canvas: composite as any,
  };

  return new Uint8Array(writePsd(psd, { compress: true }));
}
