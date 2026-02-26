import type { BrushPreset, BrushTip, BrushDynamics } from "./types";

// ── Default soft round brush ──

export async function createDefaultRoundBrush(): Promise<BrushTip> {
  const size = 128;
  const imageData = new ImageData(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
      const alpha =
        dist >= radius
          ? 0
          : Math.round(
              255 * (Math.cos((dist / radius) * Math.PI) * 0.5 + 0.5),
            );
      const i = (y * size + x) * 4;
      imageData.data[i] = 255;
      imageData.data[i + 1] = 255;
      imageData.data[i + 2] = 255;
      imageData.data[i + 3] = alpha;
    }
  }

  const bitmap = await createImageBitmap(imageData);
  return { name: "Soft Round", bitmap, diameter: size, spacing: 0.15 };
}

export function createDefaultPreset(tip: BrushTip): BrushPreset {
  return {
    id: "default-soft-round",
    name: "Soft Round",
    tip,
    dynamics: {
      pressureSize: true,
      pressureOpacity: true,
      tiltAngle: false,
      sizeJitter: 0,
      angleJitter: 0,
    },
  };
}

// ── Stroke state ──

interface StrokeState {
  lastX: number;
  lastY: number;
  distanceAccum: number;
  active: boolean;
}

// ── BrushEngine ──

export class BrushEngine {
  private preset: BrushPreset;
  private tintedStamp: OffscreenCanvas | null = null;
  private tintedColor = "";
  private stroke: StrokeState = {
    lastX: 0,
    lastY: 0,
    distanceAccum: 0,
    active: false,
  };

  private _size = 8;
  private _color = "#ffffff";
  private _opacity = 1.0;
  private _dpr = 1;

  constructor(preset: BrushPreset) {
    this.preset = preset;
  }

  setPreset(preset: BrushPreset): void {
    this.preset = preset;
    this.tintedStamp = null;
  }

  setColor(color: string): void {
    if (this._color !== color) {
      this._color = color;
      this.tintedStamp = null;
    }
  }

  setSize(size: number): void {
    this._size = size;
  }

  setOpacity(opacity: number): void {
    this._opacity = opacity;
  }

  setDpr(dpr: number): void {
    this._dpr = dpr;
  }

  getPreset(): BrushPreset {
    return this.preset;
  }

  // ── Tinted stamp cache ──

  private ensureTintedStamp(): OffscreenCanvas {
    if (this.tintedStamp && this.tintedColor === this._color) {
      return this.tintedStamp;
    }

    const tip = this.preset.tip;
    const w = tip.bitmap.width;
    const h = tip.bitmap.height;

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = this._color;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(tip.bitmap, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    this.tintedStamp = canvas;
    this.tintedColor = this._color;
    return canvas;
  }

  // ── Stroke lifecycle ──

  beginStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    tiltX = 0,
    tiltY = 0,
  ): void {
    this.stroke = { lastX: x, lastY: y, distanceAccum: 0, active: true };
    this.placeStamp(ctx, x, y, pressure, tiltX, tiltY);
  }

  addPoint(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    tiltX = 0,
    tiltY = 0,
  ): void {
    if (!this.stroke.active) return;

    const dx = x - this.stroke.lastX;
    const dy = y - this.stroke.lastY;
    const segmentDist = Math.sqrt(dx * dx + dy * dy);
    if (segmentDist === 0) return;

    const spacingPx = Math.max(1, this._size * this.preset.tip.spacing);
    const remaining = spacingPx - this.stroke.distanceAccum;

    let traveled = 0;

    if (segmentDist >= remaining) {
      // First stamp at spacing threshold
      traveled = remaining;
      const firstT = remaining / segmentDist;
      this.placeStamp(
        ctx,
        this.stroke.lastX + dx * firstT,
        this.stroke.lastY + dy * firstT,
        pressure,
        tiltX,
        tiltY,
      );

      // Remaining stamps at regular intervals
      while (traveled + spacingPx <= segmentDist) {
        traveled += spacingPx;
        const t = traveled / segmentDist;
        this.placeStamp(
          ctx,
          this.stroke.lastX + dx * t,
          this.stroke.lastY + dy * t,
          pressure,
          tiltX,
          tiltY,
        );
      }

      this.stroke.distanceAccum = segmentDist - traveled;
    } else {
      this.stroke.distanceAccum += segmentDist;
    }

    this.stroke.lastX = x;
    this.stroke.lastY = y;
  }

  endStroke(): void {
    this.stroke.active = false;
    this.stroke.distanceAccum = 0;
  }

  // ── Stamp placement ──

  private placeStamp(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
  ): void {
    const dpr = this._dpr;
    const dynamics = this.preset.dynamics;
    const stamp = this.ensureTintedStamp();

    // Size
    let stampDiameter = this._size * dpr;
    if (dynamics.pressureSize) {
      stampDiameter *= Math.max(0.1, pressure);
    }
    if (dynamics.sizeJitter > 0) {
      stampDiameter *= 1 - dynamics.sizeJitter * Math.random();
    }

    // Opacity
    let stampOpacity = this._opacity;
    if (dynamics.pressureOpacity) {
      stampOpacity *= pressure;
    }

    // Rotation
    let angle = 0;
    if (dynamics.tiltAngle && (tiltX !== 0 || tiltY !== 0)) {
      angle = Math.atan2(tiltY, tiltX);
    }
    if (dynamics.angleJitter > 0) {
      angle += dynamics.angleJitter * Math.PI * 2 * (Math.random() - 0.5);
    }

    // Draw
    const px = x * dpr;
    const py = y * dpr;
    const half = stampDiameter / 2;

    ctx.save();
    ctx.globalAlpha = stampOpacity;
    ctx.translate(px, py);
    if (angle !== 0) ctx.rotate(angle);
    ctx.drawImage(stamp, -half, -half, stampDiameter, stampDiameter);
    ctx.restore();
  }
}
