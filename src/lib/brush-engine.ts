import type {
  BrushPreset,
  BrushTip,
  BrushDynamics,
  DynamicsController,
} from "./types";

// ── Helpers ──

export function defaultController(): DynamicsController {
  return { control: "off", jitter: 0, minimum: 0, fadeSteps: 0 };
}

export function defaultDynamics(): BrushDynamics {
  return {
    size: { control: "pressure", jitter: 0, minimum: 0.1, fadeSteps: 0 },
    angle: defaultController(),
    roundness: defaultController(),
    scatterEnabled: false,
    scatter: defaultController(),
    scatterCount: 1,
    scatterBothAxes: false,
    opacity: { control: "pressure", jitter: 0, minimum: 0, fadeSteps: 0 },
    flow: defaultController(),
    spacing: 0.15,
    tipAngle: 0,
    tipRoundness: 1,
    flipX: false,
    flipY: false,
    hardness: 1,
  };
}

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
    dynamics: defaultDynamics(),
  };
}

// ── Stroke state ──

interface StrokeState {
  lastX: number;
  lastY: number;
  dirX: number;
  dirY: number;
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
    dirX: 1,
    dirY: 0,
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
    this.stroke = {
      lastX: x,
      lastY: y,
      dirX: 1,
      dirY: 0,
      distanceAccum: 0,
      active: true,
    };
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

    // Update stroke direction
    this.stroke.dirX = dx / segmentDist;
    this.stroke.dirY = dy / segmentDist;

    const dynamics = this.preset.dynamics;
    const spacingPx = Math.max(1, this._size * dynamics.spacing);
    const remaining = spacingPx - this.stroke.distanceAccum;
    const count = Math.max(1, Math.round(dynamics.scatterCount));

    let traveled = 0;

    if (segmentDist >= remaining) {
      // First stamp at spacing threshold
      traveled = remaining;
      const firstT = remaining / segmentDist;
      const sx = this.stroke.lastX + dx * firstT;
      const sy = this.stroke.lastY + dy * firstT;
      for (let c = 0; c < count; c++) {
        this.placeStamp(ctx, sx, sy, pressure, tiltX, tiltY);
      }

      // Remaining stamps at regular intervals
      while (traveled + spacingPx <= segmentDist) {
        traveled += spacingPx;
        const t = traveled / segmentDist;
        const sx2 = this.stroke.lastX + dx * t;
        const sy2 = this.stroke.lastY + dy * t;
        for (let c = 0; c < count; c++) {
          this.placeStamp(ctx, sx2, sy2, pressure, tiltX, tiltY);
        }
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

  // ── Apply a dynamics controller ──

  private applyController(
    ctrl: DynamicsController,
    pressure: number,
    tiltX: number,
    tiltY: number,
  ): number {
    const min = ctrl.minimum;
    switch (ctrl.control) {
      case "pressure":
        return min + (1 - min) * pressure;
      case "tilt": {
        const tiltAmount =
          Math.sqrt(tiltX * tiltX + tiltY * tiltY) / 90;
        return min + (1 - min) * tiltAmount;
      }
      case "direction":
      case "fade":
      case "off":
      default:
        return 1;
    }
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
    stampDiameter *= this.applyController(
      dynamics.size,
      pressure,
      tiltX,
      tiltY,
    );
    if (dynamics.size.jitter > 0) {
      stampDiameter *= 1 - dynamics.size.jitter * Math.random();
    }
    if (stampDiameter < 0.5) return;

    // Opacity
    let stampOpacity = this._opacity;
    stampOpacity *= this.applyController(
      dynamics.opacity,
      pressure,
      tiltX,
      tiltY,
    );
    if (dynamics.opacity.jitter > 0) {
      stampOpacity *= 1 - dynamics.opacity.jitter * Math.random();
    }
    if (stampOpacity < 0.003) return;

    // Position (with scatter)
    let px = x * dpr;
    let py = y * dpr;

    if (dynamics.scatterEnabled && dynamics.scatter.jitter > 0) {
      const scatterAmount = dynamics.scatter.jitter * this._size * dpr;
      // Perpendicular to stroke direction
      const perpX = -this.stroke.dirY;
      const perpY = this.stroke.dirX;
      const offset = (Math.random() - 0.5) * 2 * scatterAmount;
      px += perpX * offset;
      py += perpY * offset;
      if (dynamics.scatterBothAxes) {
        const along = (Math.random() - 0.5) * 2 * scatterAmount;
        px += this.stroke.dirX * along;
        py += this.stroke.dirY * along;
      }
    }

    // Rotation
    let angle = dynamics.tipAngle;
    if (dynamics.angle.control === "direction") {
      angle += Math.atan2(this.stroke.dirY, this.stroke.dirX);
    } else if (dynamics.angle.control === "tilt") {
      if (tiltX !== 0 || tiltY !== 0) {
        angle += Math.atan2(tiltY, tiltX);
      }
    }
    if (dynamics.angle.jitter > 0) {
      angle +=
        dynamics.angle.jitter * Math.PI * 2 * (Math.random() - 0.5);
    }

    // Roundness (affects Y scale of stamp)
    let roundness = dynamics.tipRoundness;
    roundness *= this.applyController(
      dynamics.roundness,
      pressure,
      tiltX,
      tiltY,
    );
    if (dynamics.roundness.jitter > 0) {
      roundness *= 1 - dynamics.roundness.jitter * Math.random();
    }

    // Draw
    const halfW = stampDiameter / 2;
    const halfH = (stampDiameter * roundness) / 2;

    ctx.save();
    ctx.globalAlpha = stampOpacity;
    ctx.translate(px, py);
    if (angle !== 0) ctx.rotate(angle);
    if (dynamics.flipX) ctx.scale(-1, 1);
    if (dynamics.flipY) ctx.scale(1, -1);
    ctx.drawImage(stamp, -halfW, -halfH, stampDiameter, stampDiameter * roundness);
    ctx.restore();
  }
}
