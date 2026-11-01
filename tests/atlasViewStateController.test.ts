import assert from "node:assert/strict";
import { test } from "node:test";
import { AtlasViewStateController } from "../src/navigation/atlasViewStateController.ts";
import type { ViewState } from "../src/viewState.ts";

const NOW = "2026-10-30T12:00:00.000Z";
const LATER = "2026-11-30T12:00:00.000Z";
const view = (fields: Partial<ViewState> = {}): ViewState => ({ center: { x: 1, y: 2 }, zoom: 24, time: NOW, layers: {}, ...fields });
const tourStep = (step: number, signal = new AbortController().signal) => ({ animate: false, slug: "near-the-sun", step, restoring: false, signal });

/** The controller with a stub of the browser address and of the atlas. */
function atlas(address = "/?v=1", changes: Record<string, unknown> = {}) {
  const url = new URL(address, "http://atlas.test");
  const location = { get pathname() { return url.pathname; }, get search() { return url.search; }, hash: "" };
  const go = (next: string) => { const target = new URL(next, url); url.pathname = target.pathname; url.search = target.search; };
  const writes: string[] = [];
  const write = (kind: string) => (_state: unknown, _title: string, next: string) => { writes.push(kind); go(next); };
  Object.assign(globalThis, {
    window: { location, setTimeout, clearTimeout },
    history: { pushState: write("push"), replaceState: write("replace") },
  });
  const dismissed: string[] = [];
  const selected: string[] = [];
  const state = {
    camera: { xAu: 0, yAu: 0, pxPerAu: 24 },
    viewTime: NOW,
    activeZoomPreset: null,
    displayLayers: {},
    activeFilter: "all",
    activeCompareFilter: "all",
    selectedKey: "",
    compareTargetKey: null,
  };
  const controller: AtlasViewStateController = new AtlasViewStateController({
    state,
    constellations: { hidden: [] },
    manifest: { state: "ready", value: null },
    pointStream: { prewarm: () => undefined },
    minimumZoom: 1e-14,
    maximumZoom: 5e7,
    localZoomDurationMs: 0,
    isEmbedMode: false,
    hasEphemeris: () => true,
    transientSelectedKey: () => null,
    selectBodyByKey: async (key: string) => { selected.push(key); },
    setCompareTargetByKey: async () => undefined,
    dismissSelection: () => { dismissed.push(url.search); },
    updateAllUi: () => undefined,
    updateScale: () => undefined,
    requestRender: () => undefined,
    requestDataRefresh: () => undefined,
    loadAtlas: async () => undefined,
    animateCameraTo: (_target: unknown, _duration: number, done: () => void) => done(),
    skyState: () => undefined,
    restoreSky: async () => undefined,
    universeState: () => undefined,
    restoreUniverse: () => undefined,
    ...changes,
  } as never, null);
  return { controller, state, url, go, writes, dismissed, selected };
}

test("a restore that fails does not stop later address updates", async () => {
  const { controller, state, url, writes } = atlas("/?v=1", { selectBodyByKey: () => Promise.reject(new Error("offline")) });
  await assert.rejects(controller.restore(view({ objectKey: "m31" })), /offline/);
  assert.equal(controller.restoring, false);
  assert.equal(controller.hasPendingSelection, false);
  state.camera = { ...state.camera, xAu: 55 };
  controller.replace();
  assert.deepEqual(writes, ["replace"]);
  assert.match(url.search, /55/);
});

test("a time load that fails leaves no old selection for the next load", async () => {
  for (const loadAtlas of [async () => undefined, () => Promise.reject(new Error("offline"))]) {
    const { controller } = atlas("/?v=1", { loadAtlas });
    await controller.restore(view({ time: LATER, objectKey: "m31" })).catch(() => undefined);
    assert.equal(controller.restoring, false);
    assert.equal(controller.hasPendingSelection, false);
  }
});

test("a time load gives the restored selection to the atlas", async () => {
  const taken: Array<ViewState | null> = [];
  const context = atlas("/?v=1", { loadAtlas: async () => { taken.push(context.controller.takePendingSelection()); } });
  const target = view({ time: LATER, objectKey: "m31" });
  await context.controller.restore(target);
  assert.deepEqual(taken, [target]);
});

test("the end of an older restore keeps the selection of the newer restore", async () => {
  let finishLoad = () => {};
  const { controller } = atlas("/?v=1", { loadAtlas: () => new Promise<void>((resolve) => { finishLoad = resolve; }) });
  const older = controller.restore(view({ time: LATER, objectKey: "m31" }));
  const finishOlder = finishLoad;
  const newer = controller.restore(view({ time: NOW, objectKey: "m42" }));
  finishOlder();
  await older;
  assert.equal(controller.hasPendingSelection, true);
  finishLoad();
  await newer;
});

test("history closes the inspector when the view has no object", async () => {
  const { controller, dismissed, selected } = atlas();
  await controller.restore(view());
  assert.equal(dismissed.length, 1);
  assert.deepEqual(selected, []);
  await controller.restore(view({ objectKey: "m31" }));
  assert.equal(dismissed.length, 1);
  assert.deepEqual(selected, ["m31"]);
});

test("history with a new time closes the inspector when the load gives the view to the atlas", async () => {
  const context = atlas("/?v=1", {
    loadAtlas: async () => {
      const pending = context.controller.takePendingSelection();
      if (pending) await context.controller.restoreSelection(pending);
    },
  });
  await context.controller.restore(view({ time: LATER }));
  assert.equal(context.dismissed.length, 1);
});

test("a tour step with no object closes the inspector one time", async () => {
  const { controller, dismissed } = atlas();
  await controller.navigateTour(view(), tourStep(1));
  assert.equal(dismissed.length, 1);
});

test("a tour address keeps the parameters of the page", async () => {
  const { controller, url } = atlas("/?v=1&lang=es&dynamicPointFallback=1&perf=1");
  await controller.navigateTour(view(), tourStep(2));
  const params = new URLSearchParams(url.search);
  assert.equal(params.get("tour"), "near-the-sun");
  assert.equal(params.get("step"), "2");
  assert.equal(params.get("lang"), "es");
  assert.equal(params.get("dynamicPointFallback"), "1");
  assert.equal(params.get("perf"), "1");
  await controller.navigateTour(view(), tourStep(3));
  assert.equal(new URLSearchParams(url.search).get("lang"), "es");
});

test("an ordinary address keeps the same parameters as a tour address", () => {
  const { controller } = atlas("/?v=1&lang=es&dynamicPointFallback=1&perf=1&tour=old");
  const params = new URLSearchParams(controller.currentUrl().split("?")[1]);
  assert.equal(params.get("lang"), "es");
  assert.equal(params.get("dynamicPointFallback"), "1");
  assert.equal(params.get("perf"), "1");
  assert.equal(params.has("tour"), false);
});

test("a selection during a tour does not remove the tour address", async () => {
  const { controller, state, url, writes } = atlas();
  await controller.navigateTour(view(), tourStep(1));
  const address = url.search;
  writes.length = 0;
  state.selectedKey = "m42";
  controller.push();
  assert.deepEqual(writes, []);
  assert.equal(url.search, address);
});

test("a selection before the first step of a tour does not remove the tour address", () => {
  const { controller, writes } = atlas("/?tour=near-the-sun&step=1");
  controller.push();
  assert.deepEqual(writes, []);
});

test("the end of a tour removes its address and starts address updates again", async () => {
  const { controller, state, url, writes } = atlas();
  await controller.navigateTour(view(), tourStep(1));
  controller.endTour();
  assert.equal(new URLSearchParams(url.search).has("tour"), false);
  writes.length = 0;
  state.selectedKey = "m42";
  controller.push();
  assert.deepEqual(writes, ["push"]);
});

test("Back to an address of a closed tour does not stop address updates", async () => {
  const { controller, go, url, writes } = atlas();
  await controller.navigateTour(view(), tourStep(1));
  const tourAddress = `${url.pathname}${url.search}`;
  controller.endTour();
  go(tourAddress);
  writes.length = 0;
  controller.push();
  assert.deepEqual(writes, ["push"]);
  assert.equal(new URLSearchParams(url.search).has("tour"), false);
});

test("a new tour keeps its address after an earlier tour closed", async () => {
  const { controller, writes } = atlas();
  await controller.navigateTour(view(), tourStep(1));
  controller.endTour();
  await controller.navigateTour(view(), tourStep(0));
  writes.length = 0;
  controller.push();
  controller.replace();
  assert.deepEqual(writes, []);
});
