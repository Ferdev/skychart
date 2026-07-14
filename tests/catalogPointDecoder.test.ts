import assert from "node:assert/strict";
import { CatalogPointDecoder } from "../src/catalog/catalogPointDecoder.ts";

const decoder = new CatalogPointDecoder(() => null);

const smp2 = new ArrayBuffer(20);
const smp2View = new DataView(smp2);
for (const [index, value] of [..."SMP2"].entries()) smp2View.setUint8(index, value.charCodeAt(0));
smp2View.setUint32(4, 1, true);
smp2View.setFloat32(8, 12, true);
smp2View.setFloat32(12, 23, true);
smp2View.setUint8(16, 10);
smp2View.setUint8(17, 20);
smp2View.setUint8(18, 30);
smp2View.setUint8(19, 40);

const smp2Payload = await decoder.decode(smp2, {
  bounds: { min_x_au: 10, max_x_au: 20, min_y_au: 20, max_y_au: 30 },
  groups: ["gaia_local_stars"],
  types: ["star"],
  limit: 100,
  total: 7,
});

assert.equal(smp2Payload.format, "SMP2");
assert.equal(smp2Payload.returned, 1);
assert.equal(smp2Payload.total, 7);
assert.deepEqual(smp2Payload.origin, { x: 10, y: 20 });
assert.ok(Math.abs(smp2Payload.vertices[0] - 2) < 1e-6);
assert.ok(Math.abs(smp2Payload.vertices[1] - 3) < 1e-6);
assert.deepEqual([...new Uint8Array(smp2Payload.vertices.buffer).slice(8, 12)], [10, 20, 30, 40]);

const smp3 = new ArrayBuffer(40);
const smp3View = new DataView(smp3);
for (const [index, value] of [..."SMP3"].entries()) smp3View.setUint8(index, value.charCodeAt(0));
smp3View.setUint16(6, 3, true);
smp3View.setFloat64(8, 100, true);
smp3View.setFloat64(16, 200, true);
smp3View.setFloat32(24, 10, true);
smp3View.setUint32(28, 1, true);
smp3View.setUint16(32, 32_768, true);
smp3View.setUint16(34, 65_535, true);
smp3View.setUint8(36, 9);
smp3View.setUint8(37, 1);
smp3View.setUint8(38, 200);
smp3View.setUint8(39, 4);

const smp3Payload = await decoder.decode(smp3, {
  bounds: { min_x_au: 100, max_x_au: 110, min_y_au: 200, max_y_au: 210 },
  groups: ["desi_dr1_galaxies"],
  types: ["galaxy"],
  limit: 1,
  colorLut: [[0, 0, 0], [11, 22, 33]],
});

assert.equal(smp3Payload.format, "SMP3");
assert.equal(smp3Payload.flags, 3);
assert.deepEqual(smp3Payload.origin, { x: 100, y: 200 });
assert.ok(Math.abs(smp3Payload.vertices[0] - 5) < 0.001);
assert.ok(Math.abs(smp3Payload.vertices[1] - 10) < 0.001);
assert.deepEqual([...new Uint8Array(smp3Payload.vertices.buffer).slice(8, 14)], [11, 22, 33, 200, 9, 4]);

await assert.rejects(
  () => decoder.decode(new ArrayBuffer(8), {
    bounds: { min_x_au: 0, max_x_au: 1, min_y_au: 0, max_y_au: 1 },
    groups: [],
    types: [],
    limit: 1,
  }),
  /unknown format/,
);

decoder.dispose();
console.log("catalog point decoder tests passed");
