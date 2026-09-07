import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogPointStream } from "../src/catalog/catalogPointStream.ts";
import type { CatalogPointStreamOptions } from "../src/catalog/catalogPointStream.ts";
import type { CatalogPointTileRequest } from "../src/atlas/contracts.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const tile = (key: string): CatalogPointTileRequest => ({
  key, signature: key, layerId: key, staticUrl: `/${key}`, priority: 0,
  phase: "active", params: new URLSearchParams(), groups: [], types: [], limit: 1,
  bounds: { min_x_au: 0, max_x_au: 1, min_y_au: 0, max_y_au: 1 },
});

for (const sameActiveTiles of [false, true]) {
  test(`cached wide view stops obsolete prefetch, same active tiles: ${sameActiveTiles}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let wide = false;
    const requested: string[] = [];
    let prefetchSignal: AbortSignal | undefined;
    const active = [tile("active-a"), tile("active-b")];
    const options = {
      manifest: { state: "ready", value: {} },
      planner: {
        plan: () => wide && !sameActiveTiles ? active.slice(0, 1) : active,
        prioritize: (requests: CatalogPointTileRequest[]) => [...requests],
        prefetch: () => wide ? [] : [tile("prefetch-a"), tile("prefetch-b")],
      },
      decoder: {},
      viewport: () => ({}), canLoad: () => true, isEmbed: () => false,
      setLayer: () => {}, onChange: () => {}, requestRender: () => {},
      fetcher: async (url: string, init: RequestInit) => {
        requested.push(url);
        if (url === "/prefetch-a") {
          prefetchSignal = init.signal as AbortSignal;
          return new Promise<Response>((_resolve, reject) => {
            prefetchSignal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        }
        return new Response(null, { status: 404 }); // Empty but cached tile.
      },
    } as unknown as CatalogPointStreamOptions;
    const stream = new CatalogPointStream(options);
    t.after(() => stream.cancel());
    stream.schedule({ immediate: true });
    await flush();
    assert.equal(stream.stats().loadedTileCount, 2);
    t.mock.timers.tick(350);
    await flush();
    assert.ok(prefetchSignal);
    assert.deepEqual(requested, ["/active-a", "/active-b", "/prefetch-a"]);

    wide = true;
    stream.schedule({ immediate: true });
    await flush();
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(prefetchSignal.aborted, true);
    assert.equal(stream.stats().activeInFlight, 0, "wide view uses cached active tiles");
    assert.equal(stream.stats().prefetchInFlight, 0);
    assert.equal(requested.includes("/prefetch-b"), false, "obsolete queue must not request its next tile");
  });
}
