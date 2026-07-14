import assert from "node:assert/strict";
import { CatalogPointManifestRepository } from "../src/catalog/catalogPointManifest.ts";

const smp2Manifest = {
  version: "v-test",
  format: "SMP2",
  tile_url_template: "https://catalog.example/{span}/{x}/{y}.bin",
  groups: ["gaia_local_stars"],
  levels: [{ span_log2: 4, span_au: 16, point_count: 12 }],
  source_counts: { gaia_local_stars: 12 },
};

const repository = new CatalogPointManifestRepository({
  manifestUrl: "https://catalog.example/manifest.json",
  allowDynamicFallback: false,
  fetcher: async () => Response.json(smp2Manifest),
});
await repository.load();
assert.equal(repository.state, "ready");
assert.equal(repository.value?.version, "v-test");
assert.equal(repository.value?.layers[0].levels[0].span_au, 16);
assert.deepEqual(repository.value?.source_counts, { gaia_local_stars: 12 });

const originalFetch = globalThis.fetch;
let defaultFetchReceiver: unknown;
globalThis.fetch = function (this: unknown) {
  defaultFetchReceiver = this;
  return Promise.resolve(Response.json(smp2Manifest));
} as typeof fetch;
try {
  const defaultFetcherRepository = new CatalogPointManifestRepository({
    manifestUrl: "https://catalog.example/default-fetcher.json",
    allowDynamicFallback: false,
  });
  await defaultFetcherRepository.load();
  assert.equal(defaultFetcherRepository.state, "ready");
  assert.equal(defaultFetchReceiver, globalThis, "native fetch must retain its global receiver");
} finally {
  globalThis.fetch = originalFetch;
}

const missing = new CatalogPointManifestRepository({
  manifestUrl: "https://catalog.example/missing.json",
  allowDynamicFallback: true,
  fetcher: async () => new Response(null, { status: 404 }),
});
await missing.load();
assert.equal(missing.state, "missing");
assert.equal(missing.value, null);
assert.equal(missing.allowDynamicFallback, true);

const header = new ArrayBuffer(16);
const headerView = new DataView(header);
for (const [index, value] of [..."SMPK1"].entries()) headerView.setUint8(index, value.charCodeAt(0));
headerView.setUint32(12, 1, true);
const index = new ArrayBuffer(24);
const requests: string[] = [];
const containerRepository = new CatalogPointManifestRepository({
  manifestUrl: "https://catalog.example/smp3.json",
  allowDynamicFallback: false,
  fetcher: async (url, init) => {
    requests.push(`${url}|${new Headers(init?.headers).get("Range") ?? "manifest"}`);
    if (url.endsWith("smp3.json")) {
      return Response.json({
        version: "v3",
        format: "SMP3",
        color_lut: [[1, 2, 3]],
        layers: [{
          id: "gaia",
          container: "https://catalog.example/gaia.smpk",
          groups: ["gaia_500pc_stars"],
          types: ["star", "not-a-real-type"],
          levels: [{ span_log2: 8, span_au: 256 }],
        }],
      });
    }
    if (new Headers(init?.headers).get("Range") === "bytes=0-15") {
      return new Response(header, { status: 206 });
    }
    return new Response(index, { status: 206 });
  },
});
await containerRepository.load();
assert.equal(containerRepository.state, "ready");
assert.deepEqual(containerRepository.value?.layers[0].types, ["star"]);
assert.equal(containerRepository.value?.layers[0].containerIndex?.count, 1);
assert.deepEqual(requests, [
  "https://catalog.example/smp3.json|manifest",
  "https://catalog.example/gaia.smpk|bytes=0-15",
  "https://catalog.example/gaia.smpk|bytes=16-39",
]);

console.log("catalog point manifest tests passed");
