import type {
  CatalogPointDecoded,
  CatalogPointPayload,
} from "../atlas/contracts";

const SMP2_HEADER_BYTES = 8;
const SMP2_RECORD_BYTES = 12;
const SMP2_VERTEX_STRIDE_FLOATS = 3;

export type CatalogPointDecodeRequest = {
  bounds: CatalogPointPayload["bounds"];
  groups: readonly string[];
  types: readonly string[];
  limit: number;
  total?: number;
  colorLut?: readonly (readonly number[])[];
};

type DecodeSuccess = { id: number; ok: true } & CatalogPointDecoded;
type DecodeFailure = { id: number; ok: false; error: string };
type DecodeCallback = {
  resolve(value: CatalogPointDecoded): void;
  reject(reason?: unknown): void;
};

/**
 * Owns both catalog-point decode adapters and presents one decode interface.
 * Browser builds use the worker; tests and unsupported browsers use the same
 * main-thread implementation automatically.
 */
export class CatalogPointDecoder {
  private worker: Worker | null;
  private requestId = 0;
  private readonly callbacks = new Map<number, DecodeCallback>();

  constructor(workerFactory: () => Worker | null = createDecodeWorker) {
    this.worker = workerFactory();
    this.worker?.addEventListener("message", this.handleMessage);
    this.worker?.addEventListener("error", this.handleWorkerError);
  }

  async decode(buffer: ArrayBuffer, request: CatalogPointDecodeRequest): Promise<CatalogPointPayload> {
    const decoded = await this.decodeBinary(
      buffer,
      request.bounds.min_x_au,
      request.bounds.min_y_au,
      request.colorLut ?? [],
      request.limit,
    );

    return {
      bounds: request.bounds,
      groups: [...request.groups],
      types: [...request.types],
      limit: request.limit || decoded.returned,
      total: request.total || decoded.returned,
      returned: decoded.returned,
      vertices: decoded.vertices,
      origin: { x: decoded.originX, y: decoded.originY },
      format: decoded.format,
      declared: decoded.declared,
      flags: decoded.flags,
    };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending(new Error("Catalog point decoder disposed."));
  }

  private readonly handleMessage = (event: MessageEvent<DecodeSuccess | DecodeFailure>): void => {
    const callback = this.callbacks.get(event.data.id);
    if (!callback) return;
    this.callbacks.delete(event.data.id);
    if (event.data.ok) callback.resolve(event.data);
    else callback.reject(new Error(event.data.error));
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.rejectPending(event.error ?? new Error(event.message));
    this.worker?.terminate();
    this.worker = null;
  };

  private rejectPending(error: Error): void {
    for (const callback of this.callbacks.values()) callback.reject(error);
    this.callbacks.clear();
  }

  private decodeBinary(
    buffer: ArrayBuffer,
    originX: number,
    originY: number,
    colorLut: readonly (readonly number[])[],
    maxRecords: number,
  ): Promise<CatalogPointDecoded> {
    if (!this.worker) {
      return Promise.resolve(decodeOnMainThread(buffer, originX, originY, colorLut, maxRecords));
    }

    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      try {
        this.worker?.postMessage({ id, buffer, originX, originY, colorLut, maxRecords }, [buffer]);
      } catch (error) {
        this.callbacks.delete(id);
        reject(error);
      }
    });
  }
}

function createDecodeWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../catalogPointTileWorker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    console.warn("Catalog point decode worker unavailable; decoding on main thread.", error);
    return null;
  }
}

function decodeOnMainThread(
  buffer: ArrayBuffer,
  originX: number,
  originY: number,
  colorLut: readonly (readonly number[])[],
  maxRecords: number,
): CatalogPointDecoded {
  const view = new DataView(buffer);
  const magic = buffer.byteLength >= 4
    ? String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    : "";

  if (magic === "SMP3") {
    if (buffer.byteLength < 32) throw new Error("SMP3 header was truncated.");
    const declared = view.getUint32(28, true);
    const flags = view.getUint16(6, true);
    const returned = Math.min(declared, maxRecords, Math.floor((buffer.byteLength - 32) / 8));
    const tileOriginX = view.getFloat64(8, true);
    const tileOriginY = view.getFloat64(16, true);
    const span = view.getFloat32(24, true);
    const output = new ArrayBuffer(returned * 16);
    const floats = new Float32Array(output);
    const bytes = new Uint8Array(output);

    for (let index = 0; index < returned; index += 1) {
      const inputOffset = 32 + index * 8;
      const outputOffset = index * 16;
      floats[outputOffset / 4] = view.getUint16(inputOffset, true) / 65_535 * span;
      floats[outputOffset / 4 + 1] = view.getUint16(inputOffset + 2, true) / 65_535 * span;
      const color = colorLut[view.getUint8(inputOffset + 5)] ?? [224, 196, 128];
      bytes[outputOffset + 8] = color[0] ?? 224;
      bytes[outputOffset + 9] = color[1] ?? 196;
      bytes[outputOffset + 10] = color[2] ?? 128;
      bytes[outputOffset + 11] = view.getUint8(inputOffset + 6);
      bytes[outputOffset + 12] = view.getUint8(inputOffset + 4);
      bytes[outputOffset + 13] = view.getUint8(inputOffset + 7);
    }

    return {
      returned,
      declared,
      flags,
      vertices: new Float32Array(output),
      format: "SMP3",
      originX: tileOriginX,
      originY: tileOriginY,
    };
  }

  if (magic !== "SMP2") throw new Error("Catalog point binary payload had an unknown format.");

  const returned = Math.min(view.getUint32(4, true), maxRecords);
  const expectedBytes = SMP2_HEADER_BYTES + returned * SMP2_RECORD_BYTES;
  if (buffer.byteLength < expectedBytes) throw new Error("Catalog point binary payload was truncated.");

  const floatIn = new Float32Array(buffer, SMP2_HEADER_BYTES, returned * SMP2_VERTEX_STRIDE_FLOATS);
  const byteIn = new Uint8Array(buffer, SMP2_HEADER_BYTES, returned * SMP2_RECORD_BYTES);
  const output = new ArrayBuffer(returned * SMP2_RECORD_BYTES);
  const floatOut = new Float32Array(output);
  const byteOut = new Uint8Array(output);

  for (let index = 0; index < returned; index += 1) {
    const floatOffset = index * SMP2_VERTEX_STRIDE_FLOATS;
    const byteOffset = index * SMP2_RECORD_BYTES;
    floatOut[floatOffset] = floatIn[floatOffset] - originX;
    floatOut[floatOffset + 1] = floatIn[floatOffset + 1] - originY;
    byteOut[byteOffset + 8] = byteIn[byteOffset + 8];
    byteOut[byteOffset + 9] = byteIn[byteOffset + 9];
    byteOut[byteOffset + 10] = byteIn[byteOffset + 10];
    byteOut[byteOffset + 11] = byteIn[byteOffset + 11];
  }

  return {
    returned,
    declared: returned,
    flags: 0,
    vertices: floatOut,
    format: "SMP2",
    originX,
    originY,
  };
}
