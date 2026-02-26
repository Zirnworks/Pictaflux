import type { BrushTip } from "./types";

// ── Raw brush data before ImageBitmap conversion ──

export interface AbrRawBrush {
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;
  spacing: number;
  diameter: number;
}

// ── Binary reader (big-endian) ──

class AbrReader {
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
    // Unsupported depth — fill with white
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

  // Read scanline byte counts
  for (let y = 0; y < height; y++) {
    reader.readUint16(); // scanline compressed size (skip, decode inline)
  }

  // Decode PackBits RLE
  let outIdx = 0;
  const total = width * height;

  while (outIdx < total) {
    if (reader.remaining < 1) break;
    const n = reader.readInt8();

    if (n >= 0) {
      // Literal run: n + 1 values
      const count = n + 1;
      for (let j = 0; j < count && outIdx < total; j++) {
        if (bytesPerPixel === 2) {
          pixels[outIdx++] = reader.readUint16() >> 8;
        } else {
          pixels[outIdx++] = reader.readUint8();
        }
      }
    } else if (n > -128) {
      // Repeat run: 1 - n copies of next value
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
    // n === -128: no-op
  }

  return pixels;
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
      // Sampled brush
      try {
        reader.skip(4); // misc
        const spacing = reader.readUint16();

        // Bounds: top, left, bottom, right
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

function parseAbrV6Plus(reader: AbrReader): AbrRawBrush[] {
  reader.skip(2); // sub-version
  const brushes: AbrRawBrush[] = [];

  // Scan for 8BIM resource blocks
  while (reader.remaining >= 12) {
    const sig = reader.readUint32();
    if (sig !== 0x3842494d) break; // '8BIM'

    const key = String.fromCharCode(
      reader.readUint8(),
      reader.readUint8(),
      reader.readUint8(),
      reader.readUint8(),
    );
    const blockSize = reader.readUint32();
    const blockEnd = reader.position + blockSize;

    if (key === "samp" && blockSize > 4) {
      const sampCount = reader.readUint32();

      for (let i = 0; i < sampCount; i++) {
        if (reader.remaining < 4) break;
        const brushLen = reader.readUint32();
        const brushEnd = reader.position + brushLen;

        try {
          reader.skip(4); // misc
          const spacing = reader.readUint16();
          reader.skip(1); // antialiased flag

          // Bounds
          const top = reader.readInt16();
          const left = reader.readInt16();
          const bottom = reader.readInt16();
          const right = reader.readInt16();

          const width = right - left;
          const height = bottom - top;

          if (width > 0 && height > 0 && width <= 5000 && height <= 5000) {
            reader.skip(2); // unknown
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
              width,
              height,
              pixels,
              spacing: spacing > 0 ? spacing / 100 : 0.25,
              diameter: Math.max(width, height),
            });
          }
        } catch {
          // Skip malformed brush
        }

        reader.seek(brushEnd);
      }
    }

    reader.seek(blockEnd);
  }

  return brushes;
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
    return parseAbrV6Plus(reader);
  } else {
    throw new Error(`Unsupported ABR version: ${version}`);
  }
}

export async function rawBrushToTip(raw: AbrRawBrush): Promise<BrushTip> {
  const imageData = new ImageData(raw.width, raw.height);
  for (let i = 0; i < raw.width * raw.height; i++) {
    imageData.data[i * 4] = 255;
    imageData.data[i * 4 + 1] = 255;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = raw.pixels[i];
  }

  const bitmap = await createImageBitmap(imageData);
  return {
    name: raw.name,
    bitmap,
    diameter: raw.diameter,
    spacing: raw.spacing > 0 ? raw.spacing : 0.25,
  };
}

export async function loadAbrFile(buffer: ArrayBuffer): Promise<BrushTip[]> {
  const rawBrushes = parseAbr(buffer);
  return Promise.all(rawBrushes.map(rawBrushToTip));
}
