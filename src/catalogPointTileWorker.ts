export type CatalogPointDecodeRequest = {
  id: number;
  buffer: ArrayBuffer;
  originX: number;
  originY: number;
  colorLut?: readonly (readonly number[])[];
  maxRecords?: number;
};

export type CatalogPointDecodeResult = {
  returned: number;
  declared: number;
  flags: number;
  vertices: Float32Array;
  format: "SMP2" | "SMP3";
  originX: number;
  originY: number;
};

type DecodeResponse =
  | ({ id: number; ok: true } & CatalogPointDecodeResult)
  | { id: number; ok: false; error: string };

const SMP2_HEADER_BYTES = 8;
const SMP2_RECORD_BYTES = 12;
const SMP3_HEADER_BYTES = 32;
const SMP3_RECORD_BYTES = 8;
const SMP3_VERTEX_BYTES = 16;

self.addEventListener("message", (event: MessageEvent<CatalogPointDecodeRequest>) => {
  const { id, buffer, originX, originY, colorLut, maxRecords } = event.data;
  try {
    const decoded = decodeCatalogPointBinary(buffer, originX, originY, colorLut, maxRecords);
    const response: DecodeResponse = { id, ok: true, ...decoded };
    self.postMessage(response, { transfer: [decoded.vertices.buffer] });
  } catch (error) {
    const response: DecodeResponse = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
});

export function decodeCatalogPointBinary(
  buffer: ArrayBuffer,
  originX: number,
  originY: number,
  colorLut: readonly (readonly number[])[] = [],
  maxRecords = Number.POSITIVE_INFINITY
): CatalogPointDecodeResult {
  const view = new DataView(buffer);
  const magic = buffer.byteLength >= 4
    ? String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    : "";
  if (magic === "SMP2") return decodeSmp2(buffer, originX, originY, maxRecords);
  if (magic === "SMP3") return decodeSmp3(buffer, colorLut, maxRecords);
  throw new Error("Catalog point binary payload had an unknown format.");
}

function decodeSmp2(buffer: ArrayBuffer, originX: number, originY: number, maxRecords: number): CatalogPointDecodeResult {
  const view = new DataView(buffer);
  const declared = view.getUint32(4, true);
  const returned = Math.min(declared, maxRecords);
  const expectedBytes = SMP2_HEADER_BYTES + returned * SMP2_RECORD_BYTES;
  if (buffer.byteLength < expectedBytes) throw new Error("Catalog point binary payload was truncated.");
  const floatIn = new Float32Array(buffer, SMP2_HEADER_BYTES, returned * 3);
  const byteIn = new Uint8Array(buffer, SMP2_HEADER_BYTES, returned * SMP2_RECORD_BYTES);
  const out = new ArrayBuffer(returned * SMP2_RECORD_BYTES);
  const floatOut = new Float32Array(out);
  const byteOut = new Uint8Array(out);
  for (let index = 0; index < returned; index += 1) {
    const floatOffset = index * 3;
    const byteOffset = index * SMP2_RECORD_BYTES;
    floatOut[floatOffset] = floatIn[floatOffset] - originX;
    floatOut[floatOffset + 1] = floatIn[floatOffset + 1] - originY;
    byteOut.set(byteIn.subarray(byteOffset + 8, byteOffset + 12), byteOffset + 8);
  }
  return { returned, declared, flags: 0, vertices: floatOut, format: "SMP2", originX, originY };
}

function decodeSmp3(
  buffer: ArrayBuffer,
  colorLut: readonly (readonly number[])[],
  maxRecords: number
): CatalogPointDecodeResult {
  if (buffer.byteLength < SMP3_HEADER_BYTES) throw new Error("SMP3 header was truncated.");
  const view = new DataView(buffer);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported SMP3 version ${version}.`);
  const originX = view.getFloat64(8, true);
  const originY = view.getFloat64(16, true);
  const span = view.getFloat32(24, true);
  const declared = view.getUint32(28, true);
  const flags = view.getUint16(6, true);
  const available = Math.floor(Math.max(0, buffer.byteLength - SMP3_HEADER_BYTES) / SMP3_RECORD_BYTES);
  const returned = Math.min(declared, available, maxRecords);
  const out = new ArrayBuffer(returned * SMP3_VERTEX_BYTES);
  const floats = new Float32Array(out);
  const bytes = new Uint8Array(out);
  for (let index = 0; index < returned; index += 1) {
    const input = SMP3_HEADER_BYTES + index * SMP3_RECORD_BYTES;
    const output = index * SMP3_VERTEX_BYTES;
    const floatOffset = output / 4;
    floats[floatOffset] = view.getUint16(input, true) / 65535 * span;
    floats[floatOffset + 1] = view.getUint16(input + 2, true) / 65535 * span;
    const color = colorLut[view.getUint8(input + 5)] ?? [224, 196, 128];
    bytes[output + 8] = color[0] ?? 224;
    bytes[output + 9] = color[1] ?? 196;
    bytes[output + 10] = color[2] ?? 128;
    bytes[output + 11] = view.getUint8(input + 6);
    bytes[output + 12] = view.getUint8(input + 4);
    bytes[output + 13] = view.getUint8(input + 7);
  }
  return { returned, declared, flags, vertices: new Float32Array(out), format: "SMP3", originX, originY };
}
