import type { BrushTip, BrushDynamics, BrushPreset, DynamicsController } from "./types";
import { readDescriptor, untfValue } from "./descriptor-parser";
import { defaultDynamics, defaultController } from "./brush-engine";

// ── Raw brush data before ImageBitmap conversion ──

export interface AbrRawBrush {
  name: string;
  brushId: string; // UUID from samp record (for matching to desc)
  width: number;
  height: number;
  pixels: Uint8Array;
  spacing: number;
  diameter: number;
  dynamics?: BrushDynamics; // Populated from desc block
}

// ── Binary reader (big-endian) ──

export class AbrReader {
  private view: DataView;
  private _offset: number;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this._offset = 0;
  }

  get position(): number {
    return this._offset;
  }

  get remaining(): number {
    return this.view.byteLength - this._offset;
  }

  seek(pos: number): void {
    this._offset = pos;
  }

  skip(n: number): void {
    this._offset += n;
  }

  readUint8(): number {
    const v = this.view.getUint8(this._offset);
    this._offset += 1;
    return v;
  }

  readInt8(): number {
    const v = this.view.getInt8(this._offset);
    this._offset += 1;
    return v;
  }

  readUint16(): number {
    const v = this.view.getUint16(this._offset, false);
    this._offset += 2;
    return v;
  }

  readInt16(): number {
    const v = this.view.getInt16(this._offset, false);
    this._offset += 2;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this._offset, false);
    this._offset += 4;
    return v;
  }

  readInt32(): number {
    const v = this.view.getInt32(this._offset, false);
    this._offset += 4;
    return v;
  }

  readFloat64(): number {
    const v = this.view.getFloat64(this._offset, false);
    this._offset += 8;
    return v;
  }

  readSignature(): string {
    return String.fromCharCode(
      this.view.getUint8(this._offset++),
      this.view.getUint8(this._offset++),
      this.view.getUint8(this._offset++),
      this.view.getUint8(this._offset++),
    );
  }

  readBytes(n: number): Uint8Array {
    const arr = new Uint8Array(this.view.buffer, this._offset, n);
    this._offset += n;
    return arr;
  }
}

// ── Pixel decompression ──

function readRawPixels(
  reader: AbrReader,
  width: number,
  height: number,
  depth: number,
): Uint8Array {
  const count = width * height;
  const pixels = new Uint8Array(count);

  if (depth === 8) {
    const raw = reader.readBytes(count);
    pixels.set(raw);
  } else if (depth === 16) {
    for (let i = 0; i < count; i++) {
      pixels[i] = reader.readUint16() >> 8;
    }
  } else {
    pixels.fill(255);
    reader.skip(count * (depth / 8));
  }

  return pixels;
}

function readRlePixels(
  reader: AbrReader,
  width: number,
  height: number,
  depth: number,
): Uint8Array {
  const pixels = new Uint8Array(width * height);
  const bytesPerPixel = depth === 16 ? 2 : 1;

  for (let y = 0; y < height; y++) {
    reader.readUint16();
  }

  let outIdx = 0;
  const total = width * height;

  while (outIdx < total) {
    if (reader.remaining < 1) break;
    const n = reader.readInt8();

    if (n >= 0) {
      const count = n + 1;
      for (let j = 0; j < count && outIdx < total; j++) {
        if (bytesPerPixel === 2) {
          pixels[outIdx++] = reader.readUint16() >> 8;
        } else {
          pixels[outIdx++] = reader.readUint8();
        }
      }
    } else if (n > -128) {
      const count = 1 - n;
      let val: number;
      if (bytesPerPixel === 2) {
        val = reader.readUint16() >> 8;
      } else {
        val = reader.readUint8();
      }
      for (let j = 0; j < count && outIdx < total; j++) {
        pixels[outIdx++] = val;
      }
    }
  }

  return pixels;
}

// ── Descriptor → BrushDynamics conversion ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Desc = Record<string, any>;

const BVTY_MAP: Record<number, DynamicsController["control"]> = {
  0: "off",
  1: "fade",
  2: "pressure",
  3: "tilt",
  5: "direction", // initial direction
  6: "direction",
};

function parseBrVr(obj: Desc | undefined): DynamicsController {
  if (!obj) return defaultController();
  return {
    control: BVTY_MAP[obj.bVTy as number] ?? "off",
    jitter: untfValue(obj.jitter),
    minimum: untfValue(obj["Mnm "]),
    fadeSteps: (obj.fStp as number) ?? 0,
  };
}

function descriptorToDynamics(preset: Desc): BrushDynamics {
  const dyn = defaultDynamics();
  const brsh: Desc | undefined = preset.Brsh;

  // Tip shape properties
  if (brsh) {
    dyn.spacing = untfValue(brsh.Spcn) || 0.25;
    dyn.tipAngle = untfValue(brsh.Angl);
    dyn.tipRoundness = untfValue(brsh.Rndn) || 1;
    dyn.flipX = !!brsh.flipX;
    dyn.flipY = !!brsh.flipY;
    dyn.hardness = untfValue(brsh.Hrdn) || 1;
  }

  // Shape dynamics
  if (preset.useTipDynamics) {
    dyn.size = parseBrVr(preset.szVr as Desc);
    // Also use minimumDiameter as the size minimum floor
    const minDiam = untfValue(preset.minimumDiameter);
    if (minDiam > 0 && dyn.size.control !== "off") {
      dyn.size.minimum = minDiam;
    }
    dyn.angle = parseBrVr(preset.angleDynamics as Desc);
    dyn.roundness = parseBrVr(preset.roundnessDynamics as Desc);
  }

  // Scatter
  dyn.scatterEnabled = !!preset.useScatter;
  if (dyn.scatterEnabled) {
    dyn.scatter = parseBrVr(preset.scatterDynamics as Desc);
    dyn.scatterCount = (preset["Cnt "] as number) ?? 1;
    dyn.scatterBothAxes = !!preset.bothAxes;
  }

  // Transfer / paint dynamics
  if (preset.usePaintDynamics) {
    dyn.opacity = parseBrVr(preset.opVr as Desc);
    dyn.flow = parseBrVr(preset.prVr as Desc);
  }

  // Tool options overrides (usePressureOverridesSize etc.)
  const toolOpts: Desc | undefined = preset.toolOptions;
  if (toolOpts) {
    if (toolOpts.usePressureOverridesSize && dyn.size.control === "off") {
      dyn.size = { control: "pressure", jitter: 0, minimum: 0.1, fadeSteps: 0 };
    }
    if (toolOpts.usePressureOverridesOpacity && dyn.opacity.control === "off") {
      dyn.opacity = { control: "pressure", jitter: 0, minimum: 0, fadeSteps: 0 };
    }
  }

  return dyn;
}

// ── ABR v1/v2 parser ──

function parseAbrV1V2(reader: AbrReader): AbrRawBrush[] {
  const count = reader.readUint16();
  const brushes: AbrRawBrush[] = [];

  for (let i = 0; i < count; i++) {
    if (reader.remaining < 6) break;

    const type = reader.readUint16();
    const brushSize = reader.readUint32();
    const endPos = reader.position + brushSize;

    if (type === 2 && brushSize > 0) {
      try {
        reader.skip(4);
        const spacing = reader.readUint16();

        const top = reader.readInt32();
        const left = reader.readInt32();
        const bottom = reader.readInt32();
        const right = reader.readInt32();

        const width = right - left;
        const height = bottom - top;

        if (width > 0 && height > 0 && width <= 5000 && height <= 5000) {
          const depth = reader.readUint16();
          const compression = reader.readUint8();

          let pixels: Uint8Array;
          if (compression === 0) {
            pixels = readRawPixels(reader, width, height, depth);
          } else {
            pixels = readRlePixels(reader, width, height, depth);
          }

          brushes.push({
            name: `Brush ${i + 1}`,
            brushId: "",
            width,
            height,
            pixels,
            spacing: spacing / 100,
            diameter: Math.max(width, height),
          });
        }
      } catch {
        // Skip malformed brush
      }
    }

    reader.seek(endPos);
  }

  return brushes;
}

// ── ABR v6+ parser ──

const V62_OVERHEAD = 264;

interface AbrV6Result {
  brushes: AbrRawBrush[];
  descPresets: Desc[];
}

function parseAbrV6Plus(reader: AbrReader): AbrV6Result {
  reader.skip(2); // sub-version
  const brushes: AbrRawBrush[] = [];
  let descPresets: Desc[] = [];

  // Collect 8BIM block positions first, then parse
  // (desc block may come after samp block or before)
  const blocks: { key: string; start: number; size: number }[] = [];
  const scanStart = reader.position;

  while (reader.remaining >= 12) {
    const sig = reader.readUint32();
    if (sig !== 0x3842494d) break;

    const key = String.fromCharCode(
      reader.readUint8(),
      reader.readUint8(),
      reader.readUint8(),
      reader.readUint8(),
    );
    const blockSize = reader.readUint32();
    blocks.push({ key, start: reader.position, size: blockSize });
    reader.skip(blockSize);
  }

  // Parse samp block
  for (const block of blocks) {
    if (block.key === "samp" && block.size > 8) {
      reader.seek(block.start);
      const blockEnd = block.start + block.size;
      let brushIdx = 0;

      while (reader.position < blockEnd - 4) {
        const sampleLen = reader.readUint32();
        const dataStart = reader.position;
        const dataEnd = dataStart + sampleLen;

        if (sampleLen < 1 || dataEnd > blockEnd) break;

        try {
          const idLen = reader.readUint8();
          const idBytes = reader.readBytes(idLen);
          const brushId = String.fromCharCode(...idBytes);

          const remaining = dataEnd - reader.position;
          if (remaining >= V62_OVERHEAD + 19) {
            reader.skip(V62_OVERHEAD);

            const top = reader.readInt32();
            const left = reader.readInt32();
            const bottom = reader.readInt32();
            const right = reader.readInt32();
            const width = right - left;
            const height = bottom - top;

            if (width > 0 && height > 0 && width <= 5000 && height <= 5000) {
              const depth = reader.readUint16();
              const compression = reader.readUint8();

              if (depth === 8 || depth === 16) {
                let pixels: Uint8Array;
                if (compression === 0) {
                  pixels = readRawPixels(reader, width, height, depth);
                } else {
                  pixels = readRlePixels(reader, width, height, depth);
                }

                brushes.push({
                  name: `Brush ${brushIdx + 1}`,
                  brushId,
                  width,
                  height,
                  pixels,
                  spacing: 0.25,
                  diameter: Math.max(width, height),
                });
              }
            }
          }
        } catch {
          // Skip malformed brush
        }

        reader.seek(dataEnd);
        const padding = (4 - (sampleLen % 4)) % 4;
        reader.skip(padding);
        brushIdx++;
      }
    }
  }

  // Parse desc block
  for (const block of blocks) {
    if (block.key === "desc" && block.size > 8) {
      reader.seek(block.start);
      reader.skip(4); // version prefix (typically 16)
      try {
        const desc = readDescriptor(reader);
        if (Array.isArray(desc.Brsh)) {
          descPresets = desc.Brsh as Desc[];
        }
      } catch (e) {
        console.warn("Failed to parse ABR descriptor block:", e);
      }
      break;
    }
  }

  return { brushes, descPresets };
}

// ── Match desc presets to samp brushes by UUID ──

function mergeDescriptorDynamics(
  brushes: AbrRawBrush[],
  descPresets: Desc[],
): void {
  // Build UUID → brush index map
  const uuidMap = new Map<string, number>();
  for (let i = 0; i < brushes.length; i++) {
    if (brushes[i].brushId) {
      uuidMap.set(brushes[i].brushId, i);
    }
  }

  for (const preset of descPresets) {
    const brsh: Desc | undefined = preset.Brsh;
    if (!brsh) continue;

    const uuid = brsh.sampledData as string | undefined;
    if (!uuid) continue;

    // Strip null terminator if present
    const cleanUuid = uuid.replace(/\0/g, "").trim();
    const idx = uuidMap.get(cleanUuid);
    if (idx === undefined) continue;

    // Apply name from descriptor
    const name = preset["Nm  "] as string | undefined;
    if (name) {
      brushes[idx].name = name.replace(/\0/g, "");
    }

    // Apply dynamics
    brushes[idx].dynamics = descriptorToDynamics(preset);

    // Override spacing from desc (more accurate than samp default)
    const descSpacing = untfValue(brsh.Spcn);
    if (descSpacing > 0) {
      brushes[idx].spacing = descSpacing;
    }
  }
}

// ── Public API ──

export function parseAbr(buffer: ArrayBuffer): AbrRawBrush[] {
  const reader = new AbrReader(buffer);

  if (reader.remaining < 4) {
    throw new Error("ABR file too small");
  }

  const version = reader.readUint16();

  if (version === 1 || version === 2) {
    return parseAbrV1V2(reader);
  } else if (version >= 6 && version <= 10) {
    const { brushes, descPresets } = parseAbrV6Plus(reader);
    if (descPresets.length > 0) {
      mergeDescriptorDynamics(brushes, descPresets);
    }
    return brushes;
  } else {
    throw new Error(`Unsupported ABR version: ${version}`);
  }
}

const MAX_TIP_SIZE = 1024;

export async function rawBrushToTip(raw: AbrRawBrush): Promise<BrushTip> {
  const imageData = new ImageData(raw.width, raw.height);
  for (let i = 0; i < raw.width * raw.height; i++) {
    imageData.data[i * 4] = 255;
    imageData.data[i * 4 + 1] = 255;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = raw.pixels[i];
  }

  // Downscale large bitmaps to save memory (brush stamps are max ~256px anyway)
  const maxDim = Math.max(raw.width, raw.height);
  let bitmap: ImageBitmap;
  if (maxDim > MAX_TIP_SIZE) {
    const scale = MAX_TIP_SIZE / maxDim;
    const w = Math.round(raw.width * scale);
    const h = Math.round(raw.height * scale);
    bitmap = await createImageBitmap(imageData, { resizeWidth: w, resizeHeight: h });
  } else {
    bitmap = await createImageBitmap(imageData);
  }

  return {
    name: raw.name,
    bitmap,
    diameter: raw.diameter,
    spacing: raw.spacing > 0 ? raw.spacing : 0.25,
  };
}

export async function loadAbrFile(
  buffer: ArrayBuffer,
): Promise<{ tip: BrushTip; dynamics?: BrushDynamics; presetName?: string }[]> {
  const rawBrushes = parseAbr(buffer);
  const results: { tip: BrushTip; dynamics?: BrushDynamics; presetName?: string }[] = [];

  for (const raw of rawBrushes) {
    // Skip separators and tiny placeholder brushes
    if (raw.width < 4 || raw.height < 4) continue;
    if (/^separator$/i.test(raw.name)) continue;

    const tip = await rawBrushToTip(raw);

    // Diagnostic: log per-brush dynamics
    if (raw.dynamics) {
      const d = raw.dynamics;
      console.log(`[ABR] "${raw.name}" dynamics: spacing=${d.spacing.toFixed(3)}, size=${d.size.control}(min=${d.size.minimum.toFixed(2)},jit=${d.size.jitter.toFixed(2)}), opacity=${d.opacity.control}, scatter=${d.scatterEnabled}, angle=${d.angle.control}(jit=${d.angle.jitter.toFixed(2)})`);
    } else {
      console.log(`[ABR] "${raw.name}" → NO dynamics (UUID match failed)`);
    }

    results.push({
      tip,
      dynamics: raw.dynamics,
      presetName: raw.name !== tip.name ? raw.name : undefined,
    });
  }

  return results;
}
