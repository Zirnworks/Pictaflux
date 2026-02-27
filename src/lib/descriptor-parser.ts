import { AbrReader } from "./abr-parser";

// ── Photoshop Action Descriptor binary parser ──
//
// Parses the flattened descriptor format used in ABR `desc` blocks,
// PSD layer descriptors, and other Adobe binary formats.
//
// Binary layout:
//   unicodeString → class name
//   key           → class ID
//   uint32        → item count
//   items[]       → (key, OSType tag, typed value)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DescValue = any;

/** Read a length-prefixed Unicode string (uint32 len + UTF-16BE chars). */
function readUnicodeString(r: AbrReader): string {
  const len = r.readUint32();
  let s = "";
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(r.readUint16());
  }
  return s;
}

/**
 * Read a key/classID: uint32 length, then either 4-char signature (if len=0)
 * or variable-length ASCII string.
 */
function readKey(r: AbrReader): string {
  const len = r.readUint32();
  if (len === 0) {
    return r.readSignature();
  }
  let s = "";
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(r.readUint8());
  }
  return s;
}

/** Read a single typed value based on its OSType tag. */
function readOSType(r: AbrReader, type: string): DescValue {
  switch (type) {
    case "Objc":
    case "GlbO": {
      return readDescriptorBody(r);
    }

    case "VlLs": {
      const count = r.readUint32();
      const arr: DescValue[] = [];
      for (let i = 0; i < count; i++) {
        const itemType = r.readSignature();
        arr.push(readOSType(r, itemType));
      }
      return arr;
    }

    case "UntF": {
      const unit = r.readSignature();
      const value = r.readFloat64();
      // Normalize: #Prc → 0-100 float, #Ang → degrees, #Pxl → pixels
      return { unit, value };
    }

    case "doub":
      return r.readFloat64();

    case "long":
      return r.readInt32();

    case "bool":
      return r.readUint8() !== 0;

    case "TEXT":
      return readUnicodeString(r);

    case "enum": {
      const enumType = readKey(r);
      const enumValue = readKey(r);
      return `${enumType}.${enumValue}`;
    }

    case "tdta": {
      const len = r.readUint32();
      r.skip(len);
      return null; // Binary blob — skip
    }

    case "obj ": {
      // Reference — skip
      const itemCount = r.readUint32();
      for (let i = 0; i < itemCount; i++) {
        const refType = r.readSignature();
        switch (refType) {
          case "prop":
            readUnicodeString(r); // name
            readKey(r); // classID
            readKey(r); // keyID
            break;
          case "Clss":
            readUnicodeString(r);
            readKey(r);
            break;
          case "Enmr":
            readUnicodeString(r);
            readKey(r);
            readKey(r);
            readKey(r);
            break;
          case "rele":
            readUnicodeString(r);
            readKey(r);
            r.readInt32(); // offset
            break;
          case "Idnt":
          case "indx":
            r.readInt32();
            break;
          case "name":
            readUnicodeString(r);
            readKey(r);
            readUnicodeString(r);
            break;
          default:
            // Unknown ref type — bail
            return null;
        }
      }
      return null;
    }

    case "type":
    case "GlbC": {
      readUnicodeString(r); // name
      readKey(r); // classID
      return null;
    }

    case "alis": {
      const len = r.readUint32();
      r.skip(len);
      return null;
    }

    case "ObAr": {
      // Object array
      readUnicodeString(r); // name
      readKey(r); // classID
      const count = r.readUint32();
      const arr: DescValue[] = [];
      for (let i = 0; i < count; i++) {
        // Each item has its own class structure
        const itemType = r.readSignature();
        arr.push(readOSType(r, itemType));
      }
      return arr;
    }

    case "Pth ": {
      const len = r.readUint32();
      r.skip(len);
      return null;
    }

    default:
      // Unknown type — cannot continue safely
      throw new Error(`Unknown descriptor OSType: "${type}"`);
  }
}

/** Read a descriptor body (class structure + items). */
function readDescriptorBody(r: AbrReader): Record<string, DescValue> {
  readUnicodeString(r); // class name (display only)
  readKey(r); // class ID

  const itemCount = r.readUint32();
  const obj: Record<string, DescValue> = {};

  for (let i = 0; i < itemCount; i++) {
    const key = readKey(r);
    const type = r.readSignature();
    try {
      obj[key] = readOSType(r, type);
    } catch {
      // If we hit an unknown type mid-descriptor, stop parsing
      break;
    }
  }

  return obj;
}

/**
 * Parse a Photoshop Action Descriptor from the current reader position.
 * The reader should be positioned at the start of the descriptor data
 * (after any container framing).
 */
export function readDescriptor(r: AbrReader): Record<string, DescValue> {
  return readDescriptorBody(r);
}

/**
 * Helper: extract a UntF value as a normalized number.
 * #Prc (percentage) → divide by 100 to get 0-1
 * #Ang (angle) → convert degrees to radians
 * #Pxl (pixels) → return as-is
 */
export function untfValue(
  v: unknown,
  normalize = true,
): number {
  if (v && typeof v === "object" && "unit" in v && "value" in v) {
    const { unit, value } = v as { unit: string; value: number };
    if (normalize && unit === "#Prc") return value / 100;
    if (normalize && unit === "#Ang") return (value * Math.PI) / 180;
    return value;
  }
  if (typeof v === "number") return v;
  return 0;
}
