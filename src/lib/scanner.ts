import path from "path";
import { promises as fs } from "fs";

// ───────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────

export type DetectedFormat = "safetensors" | "gguf" | "onnx" | "zip" | "pytorch" | "unknown";

export interface ParsedMetadata {
  /** Key-value pairs extracted from the file header */
  entries: Record<string, string>;
  /** Tensor names found (safetensors, gguf) */
  tensorNames: string[];
  /** Tensor shapes as string descriptors (e.g. "[768, 3072]") */
  tensorShapes: string[];
  /** Data types found (e.g. "F32", "BF16") */
  dataTypes: string[];
  /** Dependencies/frameworks identified (e.g. "pytorch", "transformers") */
  dependencies: string[];
  /** The format actually detected from magic bytes (may differ from claimed format) */
  detectedFormat: DetectedFormat;
  /** The format the user/model record claims */
  claimedFormat: string;
  /** Whether the claimed format matches the detected format */
  formatMatches: boolean;
  /** Total file size in bytes */
  fileSizeBytes: number;
  /** Header size in bytes (the portion we parsed) */
  headerSizeBytes: number;
}

export interface Vulnerability {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  detail?: string;
}

export interface SbomResult {
  sbomJson: string;
  vulnerabilities: Vulnerability[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalDeps: number;
}

// ───────────────────────────────────────────────
// Magic byte constants
// ───────────────────────────────────────────────

const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const MAGIC_GGUF = Buffer.from("GGUF", "ascii");
const MAGIC_GGJT = Buffer.from("GGJT", "ascii");

// ───────────────────────────────────────────────
// Binary reading helpers
// ───────────────────────────────────────────────

function readUint32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function readUint64LE(buf: Buffer, offset: number): bigint {
  // Read as two 32-bit parts and combine — avoids BigInt constructor
  const lo = BigInt(buf.readUInt32LE(offset));
  const hi = BigInt(buf.readUInt32LE(offset + 4));
  return (hi << 32n) | lo;
}

function readString(buf: Buffer, offset: number, length: number): string {
  return buf.toString("utf-8", offset, offset + length);
}

function readUint16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

// ───────────────────────────────────────────────
// Format detection
// ───────────────────────────────────────────────

export function detectFormat(buf: Buffer): DetectedFormat {
  if (buf.length < 4) return "unknown";

  // Check GGUF / GGJT
  if (buf.length >= 4) {
    const four = buf.subarray(0, 4);
    if (four.equals(MAGIC_GGUF) || four.equals(MAGIC_GGJT)) return "gguf";
  }

  // Check ZIP (PyTorch, SafeTensors bundles, etc.)
  if (buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC_ZIP)) return "zip";

  // Check SafeTensors: 8-byte header size followed by JSON starting with '{'
  if (buf.length >= 12) {
    try {
      const headerSize = Number(readUint64LE(buf, 0));
      if (headerSize > 0 && headerSize < buf.length - 8) {
        const firstByte = buf[8];
        if (firstByte === 0x7b) {
          // '{' — likely JSON header
          const headerStr = buf.toString("utf-8", 8, 8 + Math.min(headerSize, 1024));
          if (headerStr.startsWith("{")) {
            return "safetensors";
          }
        }
      }
    } catch {
      // Not safetensors
    }
  }

  // ONNX is protobuf — no fixed magic. Heuristic: check if the first byte
  // looks like a protobuf field tag (varint), and scan for "onnx" string in
  // the first 10KB.
  if (buf.length >= 10) {
    const firstByte = buf[0];
    // Protobuf field tags are varints; low values (0-15) are common for field numbers 1-15
    // with wire types 0-1. Check if first bytes look like valid protobuf.
    if (firstByte < 0x80) {
      const scanLimit = Math.min(buf.length, 10240);
      const scanSlice = buf.subarray(0, scanLimit).toString("utf-8");
      if (scanSlice.includes("onnx") || scanSlice.includes("ONNX") || scanSlice.includes("ai.onnx")) {
        return "onnx";
      }
    }
  }

  return "unknown";
}

// ───────────────────────────────────────────────
// SafeTensors parser
// ───────────────────────────────────────────────

function parseSafeTensors(buf: Buffer): Partial<ParsedMetadata> {
  const entries: Record<string, string> = {};
  const tensorNames: string[] = [];
  const tensorShapes: string[] = [];
  const dataTypes: string[] = [];
  const dependencies: string[] = [];

  if (buf.length < 8) return {};

  try {
    const headerSize = Number(readUint64LE(buf, 0));
    if (headerSize <= 0 || headerSize > buf.length - 8) return {};

    const headerStr = buf.toString("utf-8", 8, 8 + headerSize);
    const header = JSON.parse(headerStr) as Record<string, unknown>;

    // Extract metadata fields
    if (header.metadata && typeof header.metadata === "object") {
      const meta = header.metadata as Record<string, unknown>;
      for (const [key, value] of Object.entries(meta)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          entries[`metadata.${key}`] = String(value);
        }
      }
    }

    // Extract weight map entries (tensor info)
    if (typeof header.__metadata__ === "object" && header.__metadata__) {
      const m = header.__metadata__ as Record<string, unknown>;
      for (const [key, value] of Object.entries(m)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          entries[`__metadata__.${key}`] = String(value);
        }
      }
    }

    // Extract tensor data
    for (const [name, info] of Object.entries(header)) {
      if (name === "metadata" || name === "__metadata__") continue;
      if (typeof info === "object" && info !== null) {
        const tensorInfo = info as {
          dtype?: string;
          shape?: number[];
          data_offsets?: number[];
        };
        tensorNames.push(name);
        if (tensorInfo.shape) {
          tensorShapes.push(`[${tensorInfo.shape.join(", ")}]`);
        }
        if (tensorInfo.dtype) {
          const dt = tensorInfo.dtype.toUpperCase();
          dataTypes.push(dt);
        }
      }
    }

    // Identify dependencies from metadata
    if (entries["metadata.framework"] || entries["metadata.library"]) {
      const fw = entries["metadata.framework"] || entries["metadata.library"];
      dependencies.push(fw.toLowerCase());
    }
    if (entries["metadata.transformers_version"]) {
      dependencies.push(`transformers==${entries["metadata.transformers_version"]}`);
    }
    if (entries["metadata.pytorch_version"]) {
      dependencies.push(`torch==${entries["metadata.pytorch_version"]}`);
    }
    if (entries["metadata.model_type"]) {
      entries["model_type"] = entries["metadata.model_type"];
    }
    if (entries["metadata.architectures"]) {
      entries["architectures"] = entries["metadata.architectures"];
    }

    return {
      entries,
      tensorNames,
      tensorShapes,
      dataTypes,
      dependencies,
      headerSizeBytes: 8 + headerSize,
    };
  } catch {
    return {
      headerSizeBytes: 0,
      entries: { "parse_error": "Failed to parse SafeTensors JSON header" },
    };
  }
}

// ───────────────────────────────────────────────
// GGUF parser
// ───────────────────────────────────────────────

const GGUF_VALUE_TYPE_NAMES: Record<number, string> = {
  0: "UINT8",
  1: "INT8",
  2: "UINT16",
  3: "INT16",
  4: "UINT32",
  5: "INT32",
  6: "FLOAT32",
  7: "BOOL",
  8: "STRING",
  9: "ARRAY",
  10: "UINT64",
  11: "INT64",
  12: "FLOAT64",
};

function parseGGUF(buf: Buffer): Partial<ParsedMetadata> {
  const entries: Record<string, string> = {};
  const dependencies: string[] = [];
  const dataTypes: string[] = [];

  if (buf.length < 24) return {};

  try {
    // Magic (4) + version (4) + tensor_count (8) + metadata_kv_count (8) = 24 bytes
    const magic = buf.subarray(0, 4).toString("ascii");
    const version = readUint32LE(buf, 4);
    const tensorCount = readUint64LE(buf, 8);
    const metadataKVCount = readUint64LE(buf, 16);

    entries["gguf.magic"] = magic;
    entries["gguf.version"] = String(version);
    entries["gguf.tensor_count"] = String(tensorCount);
    entries["gguf.metadata_kv_count"] = String(metadataKVCount);

    // Parse metadata key-value pairs
    let offset = 24;

    // Limit metadata parsing to prevent OOM on huge files
    const maxMetadataEntries = 500;
    const kvCount = Number(metadataKVCount);
    const parseCount = Math.min(kvCount, maxMetadataEntries);

    for (let i = 0; i < parseCount; i++) {
      if (offset >= buf.length - 4) break;

      // Read key (uint32 length + bytes)
      const keyLen = readUint32LE(buf, offset);
      offset += 4;

      if (offset + keyLen > buf.length) break;
      const key = readString(buf, offset, keyLen);
      offset += keyLen;

      // Read value type
      if (offset + 4 > buf.length) break;
      const valueType = readUint32LE(buf, offset);
      offset += 4;

      // Parse value based on type
      const value = readGGUFValue(buf, offset, valueType);
      if (value === null) break; // out of bounds

      offset = value.newOffset;

      if (typeof value.val === "string") {
        entries[key] = value.val;
      } else if (typeof value.val === "number" || typeof value.val === "bigint" || typeof value.val === "boolean") {
        entries[key] = String(value.val);
      }

      // Track data types from tensor data
      if (key.endsWith(".dtype") && typeof value.val === "string") {
        dataTypes.push(value.val);
      }
    }

    // Identify dependencies from GGUF metadata
    if (entries["general.architecture"]) {
      entries["model_architecture"] = entries["general.architecture"];
    }
    if (entries["general.name"]) {
      entries["model_name"] = entries["general.name"];
    }
    if (entries["general.file_type"]) {
      entries["file_type"] = entries["general.file_type"];
    }
    if (entries["general.quantization_version"]) {
      entries["quantization_version"] = entries["general.quantization_version"];
      dependencies.push("llama.cpp");
    }
    if (entries["tokenizer.ggml.model"]) {
      dependencies.push(`tokenizer:${entries["tokenizer.ggml.model"]}`);
    }

    return {
      entries,
      tensorNames: [],
      tensorShapes: [],
      dataTypes,
      dependencies,
      headerSizeBytes: offset,
    };
  } catch {
    return {
      headerSizeBytes: 0,
      entries: { "parse_error": "Failed to parse GGUF metadata" },
    };
  }
}

function readGGUFValue(
  buf: Buffer,
  offset: number,
  valueType: number
): { val: string | number | bigint | boolean | null; newOffset: number } {
  try {
    switch (valueType) {
      case 0: // UINT8
        return { val: buf[offset], newOffset: offset + 1 };
      case 1: // INT8
        return { val: buf.readInt8(offset), newOffset: offset + 1 };
      case 2: // UINT16
        return { val: readUint16LE(buf, offset), newOffset: offset + 2 };
      case 3: // INT16
        return { val: buf.readInt16LE(offset), newOffset: offset + 2 };
      case 4: // UINT32
        return { val: readUint32LE(buf, offset), newOffset: offset + 4 };
      case 5: // INT32
        return { val: buf.readInt32LE(offset), newOffset: offset + 4 };
      case 6: // FLOAT32
        return { val: buf.readFloatLE(offset), newOffset: offset + 4 };
      case 7: // BOOL
        return { val: buf[offset] !== 0, newOffset: offset + 1 };
      case 8: { // STRING
        const strLen = readUint32LE(buf, offset);
        const strOffset = offset + 4;
        if (strOffset + strLen > buf.length) return { val: null, newOffset: buf.length };
        // Limit string length to prevent OOM
        const safeLen = Math.min(strLen, 65536);
        const str = readString(buf, strOffset, safeLen);
        return { val: str, newOffset: strOffset + strLen };
      }
      case 9: { // ARRAY
        const elemType = readUint32LE(buf, offset);
        const arrLen = Number(readUint64LE(buf, offset + 4));
        let arrOffset = offset + 12;
        // Skip array data — don't read it all into memory
        const elemSize = getGGUFTypeSize(elemType);
        if (elemSize > 0) {
          arrOffset += elemSize * Math.min(arrLen, 10000);
        } else {
          // Variable-size elements (strings), skip them
          for (let i = 0; i < Math.min(arrLen, 100); i++) {
            if (arrOffset >= buf.length) break;
            const result = readGGUFValue(buf, arrOffset, elemType);
            arrOffset = result.newOffset;
          }
        }
        return { val: `[array of ${arrLen} ${GGUF_VALUE_TYPE_NAMES[elemType] ?? "UNKNOWN"}]`, newOffset: arrOffset };
      }
      case 10: // UINT64
        return { val: readUint64LE(buf, offset), newOffset: offset + 8 };
      case 11: // INT64
        return { val: buf.readBigInt64LE(offset), newOffset: offset + 8 };
      case 12: // FLOAT64
        return { val: buf.readDoubleLE(offset), newOffset: offset + 8 };
      default:
        return { val: `[unknown type ${valueType}]`, newOffset: offset };
    }
  } catch {
    return { val: null, newOffset: offset + 1 };
  }
}

function getGGUFTypeSize(valueType: number): number {
  switch (valueType) {
    case 0: return 1; // UINT8
    case 1: return 1; // INT8
    case 2: return 2; // UINT16
    case 3: return 2; // INT16
    case 4: return 4; // UINT32
    case 5: return 4; // INT32
    case 6: return 4; // FLOAT32
    case 7: return 1; // BOOL
    case 8: return -1; // STRING — variable
    case 9: return -1; // ARRAY — variable
    case 10: return 8; // UINT64
    case 11: return 8; // INT64
    case 12: return 8; // FLOAT64
    default: return -1;
  }
}

// ───────────────────────────────────────────────
// ONNX parser (simplified)
// ───────────────────────────────────────────────

function parseONNX(buf: Buffer): Partial<ParsedMetadata> {
  const entries: Record<string, string> = {};
  const dependencies: string[] = [];

  // Read first 10KB and extract human-readable strings and known patterns
  const scanLimit = Math.min(buf.length, 10240);
  const scanBytes = buf.subarray(0, scanLimit);

  // Extract printable ASCII strings (min length 4)
  const strings: string[] = [];
  let current = "";
  for (let i = 0; i < scanBytes.length; i++) {
    const byte = scanBytes[i];
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= 4) {
        strings.push(current);
      }
      current = "";
    }
  }
  if (current.length >= 4) strings.push(current);

  // Extract known ONNX metadata strings
  for (const s of strings) {
    if (s.startsWith("onnx:") || s.startsWith("ai.onnx") || s === "onnx") {
      entries["onnx_domain"] = s;
    }
    if (/^\d+\.\d+\.\d+$/.test(s) && !entries["onnx_ir_version"]) {
      entries["onnx_ir_version"] = s;
    }
  }

  // Try to find producer name (common in ONNX exports)
  for (const s of strings) {
    if (
      (s.includes("onnxruntime") || s.includes("pytorch") || s.includes("tensorflow")) &&
      !entries["producer"]
    ) {
      entries["producer"] = s;
      if (s.includes("pytorch")) dependencies.push("pytorch");
      if (s.includes("tensorflow")) dependencies.push("tensorflow");
      if (s.includes("onnxruntime")) dependencies.push("onnxruntime");
    }
  }

  // Minimal protobuf field decoding for ONNX ModelProto
  // Field 1 (varint) = ir_version, Field 2 (message) = opset_import,
  // Field 4 (string) = producer_name, Field 5 (string) = domain,
  // Field 6 (string) = doc_string, Field 7 (varint) = model_version,
  // Field 8 (message) = graph
  try {
    let pbOffset = 0;
    while (pbOffset < scanBytes.length - 1) {
      // Decode varint tag
      let tag = 0;
      let shift = 0;
      while (pbOffset < scanBytes.length) {
        const b = scanBytes[pbOffset];
        pbOffset++;
        tag |= (b & 0x7f) << shift;
        shift += 7;
        if ((b & 0x80) === 0) break;
      }
      const fieldNumber = tag >>> 3;
      const wireType = tag & 0x07;

      // Only care about small field numbers (< 20) to avoid false positives
      if (fieldNumber === 0 || fieldNumber > 20) {
        // Try to skip forward — unknown structure, bail out of pb parsing
        break;
      }

      if (wireType === 0) {
        // Varint
        let value = 0n;
        let vShift = 0n;
        while (pbOffset < scanBytes.length) {
          const b = scanBytes[pbOffset];
          pbOffset++;
          value |= BigInt(b & 0x7f) << vShift;
          if ((b & 0x80) === 0) break;
          vShift += 7n;
        }
        if (fieldNumber === 1 && !entries["ir_version"]) {
          entries["ir_version"] = String(value);
        }
        if (fieldNumber === 7 && !entries["model_version"]) {
          entries["model_version"] = String(value);
        }
      } else if (wireType === 2) {
        // Length-delimited (string, bytes, or embedded message)
        let length = 0;
        let lShift = 0;
        while (pbOffset < scanBytes.length) {
          const b = scanBytes[pbOffset];
          pbOffset++;
          length |= (b & 0x7f) << lShift;
          if ((b & 0x80) === 0) break;
          lShift += 7;
        }

        // Sanity-check length
        if (length < 0 || length > 1048576) break;
        if (pbOffset + length > scanBytes.length) break;

        // For small lengths, try to extract as string
        if (length > 0 && length <= 4096) {
          const str = scanBytes.toString("utf-8", pbOffset, pbOffset + length);
          // Check if it looks like a printable string (at least 80% printable)
          let printable = 0;
          for (let i = 0; i < Math.min(str.length, 200); i++) {
            const c = str.charCodeAt(i);
            if (c >= 32 && c <= 126) printable++;
          }
          const printRatio = str.length > 0 ? printable / Math.min(str.length, 200) : 0;

          if (printRatio > 0.8 && str.length < 200) {
            if (fieldNumber === 4 && !entries["producer_name"]) {
              entries["producer_name"] = str.trim();
              if (str.toLowerCase().includes("pytorch")) dependencies.push("pytorch");
              if (str.toLowerCase().includes("tensorflow")) dependencies.push("tensorflow");
              if (str.toLowerCase().includes("onnxruntime")) dependencies.push("onnxruntime");
              if (str.toLowerCase().includes("sklearn")) dependencies.push("scikit-learn");
            }
            if (fieldNumber === 5 && !entries["domain"]) {
              entries["domain"] = str.trim();
            }
            if (fieldNumber === 6 && !entries["doc_string"]) {
              entries["doc_string"] = str.trim();
            }
          }
        }

        // For field 8 (graph), field 2 (opset_import) — these are sub-messages we skip
        if (fieldNumber === 8 && !entries["graph_info"]) {
          entries["graph_info"] = `[sub-message, ${length} bytes]`;
        }
        if (fieldNumber === 2 && !entries["opset_import_info"]) {
          entries["opset_import_info"] = `[sub-message, ${length} bytes]`;
        }

        pbOffset += length;
      } else if (wireType === 1) {
        // 64-bit fixed
        pbOffset += 8;
      } else if (wireType === 5) {
        // 32-bit fixed
        pbOffset += 4;
      } else {
        // Unknown wire type — stop parsing
        break;
      }
    }
  } catch {
    // Protobuf parsing failed, continue with string-based results
  }

  if (Object.keys(entries).length === 0) {
    entries["parse_note"] = "ONNX protobuf structure detected but no metadata extracted";
  }

  return {
    entries,
    tensorNames: [],
    tensorShapes: [],
    dataTypes: [],
    dependencies,
    headerSizeBytes: scanLimit,
  };
}

// ───────────────────────────────────────────────
// ZIP / PyTorch parser
// ───────────────────────────────────────────────

interface ZipEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  dataOffset: number;
}

function parseZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  let offset = 0;
  // Scan for local file headers: PK\x03\x04
  while (offset < buf.length - 30) {
    if (buf[offset] === 0x50 && buf[offset + 1] === 0x4b && buf[offset + 2] === 0x03 && buf[offset + 3] === 0x04) {
      const compressionMethod = readUint16LE(buf, offset + 8);
      const compressedSize = readUint32LE(buf, offset + 18);
      const filenameLen = readUint16LE(buf, offset + 26);
      const extraLen = readUint16LE(buf, offset + 28);

      if (offset + 30 + filenameLen <= buf.length) {
        const filename = readString(buf, offset + 30, filenameLen);
        entries.push({
          filename,
          compressionMethod,
          compressedSize,
          dataOffset: offset + 30 + filenameLen + extraLen,
        });
      }

      // Move to next entry
      const advance = 30 + filenameLen + extraLen + compressedSize;
      if (advance <= 0) break;
      offset += advance;
    } else {
      offset++;
    }
  }

  return entries;
}

function extractStoredEntry(buf: Buffer, entry: ZipEntry): Buffer | null {
  if (entry.compressionMethod !== 0) return null; // Not stored
  if (entry.dataOffset + entry.compressedSize > buf.length) return null;
  return buf.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
}

function parsePyTorchZip(buf: Buffer): Partial<ParsedMetadata> {
  const entries: Record<string, string> = {};
  const dependencies: string[] = [];
  const tensorNames: string[] = [];

  try {
    const zipEntries = parseZipEntries(buf);
    const filenames = zipEntries.map((e) => e.filename);

    entries["zip.entry_count"] = String(zipEntries.length);
    entries["zip.entries"] = filenames.join(", ");

    // Check for known PyTorch/HuggingFace files
    const hasConfig = filenames.includes("config.json");
    const hasSafeTensors = filenames.some((f) => f.endsWith(".safetensors"));
    const hasPytorchBin = filenames.some((f) => f.endsWith("pytorch_model.bin") || f === "pytorch_model.bin");
    const hasTokenizerConfig = filenames.includes("tokenizer_config.json");
    const hasModelCard = filenames.includes("README.md") || filenames.includes("model_card.md");

    entries["has_config.json"] = String(hasConfig);
    entries["has_safetensors"] = String(hasSafeTensors);
    entries["has_pytorch_model.bin"] = String(hasPytorchBin);
    entries["has_tokenizer_config.json"] = String(hasTokenizerConfig);
    entries["has_model_card"] = String(hasModelCard);

    // Parse config.json if present and stored (uncompressed)
    if (hasConfig) {
      const configEntry = zipEntries.find((e) => e.filename === "config.json");
      if (configEntry) {
        const configData = extractStoredEntry(buf, configEntry);
        if (configData) {
          try {
            const config = JSON.parse(configData.toString("utf-8")) as Record<string, unknown>;
            if (config.model_type) entries["model_type"] = String(config.model_type);
            if (config.architectures) {
              entries["architectures"] = JSON.stringify(config.architectures);
            }
            if (config.transformers_version) {
              entries["transformers_version"] = String(config.transformers_version);
              dependencies.push(`transformers==${config.transformers_version}`);
            }
            if (config.torch_dtype) {
              entries["torch_dtype"] = String(config.torch_dtype);
              dependencies.push(`torch (dtype: ${config.torch_dtype})`);
            }
            if (config._name_or_path) {
              entries["_name_or_path"] = String(config._name_or_path);
            }
            // Extract other useful config fields
            const configKeys = ["hidden_size", "num_hidden_layers", "num_attention_heads", "vocab_size", "max_position_embeddings"];
            for (const key of configKeys) {
              if (config[key] !== undefined) {
                entries[`config.${key}`] = String(config[key]);
              }
            }
          } catch {
            entries["config.json_parse_error"] = "Failed to parse config.json";
          }
        } else {
          entries["config.json_note"] = "config.json is compressed; cannot read without decompression";
        }
      }
    }

    // Parse tokenizer_config.json if present
    if (hasTokenizerConfig) {
      const tokEntry = zipEntries.find((e) => e.filename === "tokenizer_config.json");
      if (tokEntry) {
        const tokData = extractStoredEntry(buf, tokEntry);
        if (tokData) {
          try {
            const tokConfig = JSON.parse(tokData.toString("utf-8")) as Record<string, unknown>;
            if (tokConfig.tokenizer_class) {
              entries["tokenizer_class"] = String(tokConfig.tokenizer_class);
              dependencies.push(`tokenizer:${tokConfig.tokenizer_class}`);
            }
          } catch {
            // Ignore tokenizer parse errors
          }
        }
      }
    }

    // Collect tensor file names
    for (const entry of zipEntries) {
      if (entry.filename.endsWith(".safetensors") || entry.filename.endsWith(".bin") || entry.filename.endsWith(".pt") || entry.filename.endsWith(".pth")) {
        tensorNames.push(entry.filename);
      }
    }

    // Determine if this is a HuggingFace format model
    if (hasConfig && (hasSafeTensors || hasPytorchBin)) {
      entries["bundle_format"] = "huggingface";
      dependencies.push("huggingface_hub");
    } else if (hasPytorchBin) {
      entries["bundle_format"] = "pytorch_checkpoint";
    }

    return {
      entries,
      tensorNames,
      tensorShapes: [],
      dataTypes: [],
      dependencies,
      headerSizeBytes: Math.min(buf.length, 65536), // We scan a portion for ZIP entries
    };
  } catch {
    return {
      headerSizeBytes: 0,
      entries: { "parse_error": "Failed to parse ZIP/PyTorch archive" },
    };
  }
}

// ───────────────────────────────────────────────
// Generic / unknown format parser
// ───────────────────────────────────────────────

function parseGeneric(buf: Buffer): Partial<ParsedMetadata> {
  const result: Record<string, string> = {};

  result["file_size_bytes"] = String(buf.length);
  result["first_16_bytes_hex"] = buf.subarray(0, Math.min(16, buf.length)).toString("hex");
  result["first_16_bytes_ascii"] = buf
    .subarray(0, Math.min(16, buf.length))
    .toString("ascii")
    .replace(/[^\x20-\x7e]/g, ".");

  // Try to extract any JSON in the first 10KB
  const scanLimit = Math.min(buf.length, 10240);
  const scanStr = buf.subarray(0, scanLimit).toString("utf-8");
  const jsonMatch = scanStr.match(/\{[\s\S]{10,5000}?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed).slice(0, 20)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          result[`json.${key}`] = String(value);
        }
      }
    } catch {
      // Not valid JSON
    }
  }

  // Extract magic bytes description
  if (buf.length >= 4) {
    const magic = buf.subarray(0, 4);
    if (magic[0] === 0x89 && magic[1] === 0x48 && magic[2] === 0x44 && magic[3] === 0x46) {
      result["detected_type"] = "HDF5 (possibly Keras/TensorFlow)";
    } else if (magic[0] === 0x80 && magic[1] === 0x2b && magic[2] === 0x0a && magic[3] === 0x00) {
      result["detected_type"] = "NumPy .npy";
    } else if (buf.length >= 8) {
      const ext = buf.subarray(0, 8).toString("ascii");
      if (ext.startsWith("NUMPY")) {
        result["detected_type"] = "NumPy .npy archive";
      }
    }
  }

  return {
    entries: result,
    tensorNames: [],
    tensorShapes: [],
    dataTypes: [],
    dependencies: [],
    headerSizeBytes: scanLimit,
  };
}

// ───────────────────────────────────────────────
// Main scan entry point
// ───────────────────────────────────────────────

export interface ScanInput {
  /** The file buffer */
  buffer: Buffer;
  /** Model name */
  modelName: string;
  /** Model version string */
  modelVersion: string;
  /** The format the model record claims (from model.format) */
  claimedFormat: string;
  /** SHA-256 hash from the version record */
  sha256Hash: string;
}

/**
 * Scan a model file buffer, parse its binary format, and generate a CycloneDX 1.5 ML-BOM.
 */
export function scanModelFile(input: ScanInput): SbomResult {
  const { buffer, modelName, modelVersion, claimedFormat, sha256Hash } = input;
  const fileSizeBytes = buffer.length;
  const vulnerabilities: Vulnerability[] = [];

  // ── Check for empty/zero-byte file ──
  if (fileSizeBytes === 0) {
    vulnerabilities.push({
      id: "SCAN-EMPTY-FILE",
      severity: "CRITICAL",
      description: "File appears to be empty or corrupted",
      detail: "The uploaded file has zero bytes. No model data can be extracted.",
    });

    return buildSbomResult(
      modelName,
      modelVersion,
      sha256Hash,
      fileSizeBytes,
      claimedFormat,
      "unknown",
      {},
      [],
      [],
      [],
      [],
      vulnerabilities
    );
  }

  // ── Detect actual format from magic bytes ──
  const detectedFormat = detectFormat(buffer);
  const formatMatches = formatMatchesClaimed(claimedFormat, detectedFormat);

  // ── Check format mismatch ──
  if (!formatMatches) {
    vulnerabilities.push({
      id: "SCAN-FORMAT-MISMATCH",
      severity: "HIGH",
      description: `Format mismatch: file claims "${claimedFormat}" but magic bytes indicate "${detectedFormat}"`,
      detail: `The file's binary header does not match the declared format. This could indicate a mislabeled file, a conversion error, or a potentially malicious file.`,
    });
  }

  // ── Check suspiciously small file ──
  if (fileSizeBytes < 1024) {
    vulnerabilities.push({
      id: "SCAN-SMALL-FILE",
      severity: "MEDIUM",
      description: "File size is suspiciously small for a model artifact",
      detail: `The file is ${fileSizeBytes} bytes, which is too small to contain meaningful model weights. Typical model files are at least several megabytes.`,
    });
  }

  // ── Parse based on detected format ──
  let parsed: Partial<ParsedMetadata>;

  switch (detectedFormat) {
    case "safetensors":
      parsed = parseSafeTensors(buffer);
      break;
    case "gguf":
      parsed = parseGGUF(buffer);
      break;
    case "onnx":
      parsed = parseONNX(buffer);
      break;
    case "zip":
    case "pytorch":
      parsed = parsePyTorchZip(buffer);
      break;
    default:
      parsed = parseGeneric(buffer);
      break;
  }

  const allEntries = parsed.entries ?? {};
  const tensorNames = parsed.tensorNames ?? [];
  const tensorShapes = parsed.tensorShapes ?? [];
  const dataTypes = parsed.dataTypes ?? [];
  const dependencies = parsed.dependencies ?? [];
  const headerSizeBytes = parsed.headerSizeBytes ?? 0;

  // ── Check if header is too large ──
  if (headerSizeBytes > 0 && fileSizeBytes > 0) {
    const headerRatio = headerSizeBytes / fileSizeBytes;
    if (headerRatio > 0.9) {
      vulnerabilities.push({
        id: "SCAN-LARGE-HEADER",
        severity: "MEDIUM",
        description: "Header consumes most of the file; minimal actual model data",
        detail: `The parsed header is ${Math.round(headerRatio * 100)}% of the file size (${formatBytes(headerSizeBytes)} / ${formatBytes(fileSizeBytes)}). This suggests the file contains mostly metadata with very little model weight data.`,
      });
    }
  }

  // ── Check if no metadata was found ──
  const meaningfulEntries = Object.keys(allEntries).filter(
    (k) => !k.startsWith("parse_") && k !== "first_16_bytes_hex" && k !== "first_16_bytes_ascii"
  );
  if (meaningfulEntries.length === 0 && detectedFormat !== "unknown") {
    vulnerabilities.push({
      id: "SCAN-NO-METADATA",
      severity: "LOW",
      description: "No model metadata found in file header",
      detail: `The file was recognized as "${detectedFormat}" format but no meaningful metadata could be extracted from the header.`,
    });
  }

  return buildSbomResult(
    modelName,
    modelVersion,
    sha256Hash,
    fileSizeBytes,
    claimedFormat,
    detectedFormat,
    allEntries,
    tensorNames,
    tensorShapes,
    dataTypes,
    dependencies,
    vulnerabilities
  );
}

// ───────────────────────────────────────────────
// Format matching logic
// ───────────────────────────────────────────────

function formatMatchesClaimed(claimed: string, detected: DetectedFormat): boolean {
  const c = claimed.toLowerCase().trim();

  switch (detected) {
    case "safetensors":
      return c === "safetensors";
    case "gguf":
      return c === "gguf";
    case "onnx":
      return c === "onnx";
    case "zip":
      return c === "pytorch" || c === "zip" || c === "huggingface";
    default:
      return c === "bin" || c === "unknown";
  }
}

// ───────────────────────────────────────────────
// SBOM generation (CycloneDX 1.5 ML-BOM)
// ───────────────────────────────────────────────

function buildSbomResult(
  modelName: string,
  modelVersion: string,
  sha256Hash: string,
  fileSizeBytes: number,
  claimedFormat: string,
  detectedFormat: string,
  entries: Record<string, string>,
  tensorNames: string[],
  tensorShapes: string[],
  dataTypes: string[],
  dependencies: string[],
  vulnerabilities: Vulnerability[]
): SbomResult {
  // Build properties from parsed entries
  const properties: Array<{ name: string; value: string }> = [];

  for (const [key, value] of Object.entries(entries)) {
    properties.push({ name: key, value });
  }

  // Add derived properties
  properties.push({ name: "scan.file_size_bytes", value: String(fileSizeBytes) });
  properties.push({ name: "scan.claimed_format", value: claimedFormat });
  properties.push({ name: "scan.detected_format", value: detectedFormat });
  properties.push({ name: "scan.tensor_count", value: String(tensorNames.length) });
  properties.push({ name: "scan.unique_data_types", value: [...new Set(dataTypes)].join(", ") || "none" });

  if (sha256Hash) {
    properties.push({ name: "sha256", value: sha256Hash });
  }

  // Build components (dependencies)
  const components: Array<Record<string, unknown>> = [];

  for (const dep of dependencies) {
    let name = dep;
    let version = "unknown";
    let type = "library";

    if (dep.includes("==")) {
      const parts = dep.split("==");
      name = parts[0];
      version = parts[1];
    } else if (dep.startsWith("tokenizer:")) {
      name = dep.substring(9);
      type = "tokenizer";
    } else if (dep.startsWith("torch")) {
      name = "pytorch";
      type = "framework";
    } else if (dep.includes("transformers")) {
      name = "transformers";
      type = "framework";
    } else if (dep === "llama.cpp") {
      name = "llama.cpp";
      type = "framework";
    } else if (dep === "huggingface_hub") {
      name = "huggingface_hub";
      type = "library";
    }

    components.push({
      type: type,
      name: name,
      version: version,
      purl: `pkg:pypi/${name}@${version}`,
    });
  }

  // Count unique data types as additional "components"
  const uniqueTypes = [...new Set(dataTypes)];
  if (uniqueTypes.length > 0) {
    components.push({
      type: "data-type-set",
      name: "model_data_types",
      version: "1.0.0",
      description: uniqueTypes.join(", "),
    });
  }

  // Build CycloneDX SBOM
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: {
      component: {
        name: modelName,
        version: modelVersion,
        type: "ml-model",
        properties,
      },
    },
    components: components.length > 0 ? components : undefined,
    vulnerabilities: vulnerabilities.length > 0
      ? vulnerabilities.map((v) => ({
          id: v.id,
          severity: v.severity,
          description: v.description,
          detail: v.detail,
          analysis: {
            state: "in_triage",
            response: [],
          },
        }))
      : undefined,
  };

  // Count severity
  const criticalCount = vulnerabilities.filter((v) => v.severity === "CRITICAL").length;
  const highCount = vulnerabilities.filter((v) => v.severity === "HIGH").length;
  const mediumCount = vulnerabilities.filter((v) => v.severity === "MEDIUM").length;
  const lowCount = vulnerabilities.filter((v) => v.severity === "LOW").length;

  return {
    sbomJson: JSON.stringify(sbom, null, 2),
    vulnerabilities,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    totalDeps: dependencies.length,
  };
}

// ───────────────────────────────────────────────
// Utility: read file from storage path
// ───────────────────────────────────────────────

/**
 * Read a model file from disk.
 * `storagePath` is relative to project root (e.g. "uploads/org/model/version/file.bin").
 */
export async function readFileFromStorage(storagePath: string): Promise<Buffer> {
  const fullPath = path.resolve(process.cwd(), storagePath);
  return fs.readFile(fullPath);
}

// ───────────────────────────────────────────────
// Utility: format bytes for human display
// ───────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}