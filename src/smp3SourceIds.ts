export const SMP3_FLAG_SOURCE_IDS = 1;
export const SMP3_HEADER_BYTES = 32;
export const SMP3_RECORD_BYTES = 8;
export const SMP3_SOURCE_ID_BYTES = 8;

export function smp3SourceIdRange(
  tileOffset: number,
  tileLength: number,
  declared: number,
  pointIndex: number,
  flags: number
): { offset: number; length: number } | null {
  if ((flags & SMP3_FLAG_SOURCE_IDS) === 0 || declared <= 0 || pointIndex < 0 || pointIndex >= declared) return null;
  const offset = tileOffset + SMP3_HEADER_BYTES + declared * SMP3_RECORD_BYTES + pointIndex * SMP3_SOURCE_ID_BYTES;
  return offset + SMP3_SOURCE_ID_BYTES <= tileOffset + tileLength
    ? { offset, length: SMP3_SOURCE_ID_BYTES }
    : null;
}

export function decodeSmp3SourceId(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < SMP3_SOURCE_ID_BYTES) throw new Error("Catalog source ID Range was truncated");
  const sourceId = new DataView(buffer).getBigUint64(0, true);
  return sourceId === 0n ? null : sourceId.toString();
}
