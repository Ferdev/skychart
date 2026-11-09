import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// The player imports its modules with no file extension, as Vite allows.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});

// The player needs only a few DOM calls. This small stand-in replaces a browser.
class FakeElement {
  hidden = false;
  innerHTML = "";
  id = "";
  className = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener() {}
  querySelector() { return null; }
  append() {}
}
const globals = globalThis as unknown as Record<string, unknown>;
globals.document = { createElement: () => new FakeElement(), querySelector: () => null };
globals.window = { addEventListener() {}, setTimeout, clearTimeout, matchMedia: () => ({ matches: true }) };
globals.matchMedia = () => ({ matches: true });

const { TourPlayer } = await import("../src/tourPlayer.ts");
const { decodeViewState } = await import("../src/viewState.ts");

const view = "v=1&c=0%2C0&z=24&t=2026-10-30T00%3A00%3A00.000Z&L=grid.1";
assert.ok(decodeViewState(view), "the fixture view state decodes");

function player() {
  const events: string[] = [];
  const instance = new TourPlayer({
    navigate: async () => {},
    prewarm: () => {},
    track: (event) => events.push(event),
    translate: (key) => key,
    closed: () => {},
    locale: () => "en",
  });
  return { instance, events };
}
const tour = {
  slug: "shared-0123456789abcdef0123456789abcdef",
  title: "Analytics",
  description: "",
  steps: [
    { viewState: view, title: "First", body: "" },
    { viewState: view, title: "Last", body: "" },
  ],
};
const go = (instance: unknown, index: number) => (instance as { go(index: number): Promise<void> }).go(index);
const begin = (instance: unknown) => (instance as { begin(tour: unknown, step: number): Promise<void> }).begin(tour, 0);

test("a reader who revisits the last step sends one tour_completed", async () => {
  const { instance, events } = player();
  await begin(instance);
  await go(instance, 1);
  await go(instance, 0);
  await go(instance, 1);
  assert.deepEqual(events, ["tour_started", "tour_completed"]);
});

test("a new start of the tour counts a new session", async () => {
  const { instance, events } = player();
  await begin(instance);
  await go(instance, 1);
  await begin(instance);
  await go(instance, 1);
  assert.deepEqual(events, ["tour_started", "tour_completed", "tour_started", "tour_completed"]);
});

test("a builder preview sends no tour analytics", async () => {
  const { instance, events } = player();
  await instance.preview(tour);
  await go(instance, 1);
  await go(instance, 0);
  await go(instance, 1);
  assert.deepEqual(events, []);
});
