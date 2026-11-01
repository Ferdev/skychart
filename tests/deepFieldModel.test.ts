import assert from "node:assert/strict";
import { test } from "node:test";
import { clampView, frameStateKey, MAX_SCALE, panBy, zoomAt, type DeepFrame } from "../src/community/deepFieldModel.ts";

const frame = (changes: Partial<DeepFrame> = {}): DeepFrame => ({ slug: "m31", title: "M31", consent_at: "2026-11-01T00:00:00Z", withdrawn_at: null, weight: null, rejection_reason: null, ...changes });

test("a zoom keeps the point below the pointer in its place", () => {
  const start = { scale: 1, x: 0, y: 0 };
  const view = zoomAt(start, 2, 100, 50, 400, 300);
  assert.equal(view.scale, 2);
  // The image point under (100, 50) was (100, 50). It stays under the pointer.
  assert.equal(view.x + 100 * view.scale, 100);
  assert.equal(view.y + 50 * view.scale, 50);
});

test("the zoom has limits and the image always fills the stage", () => {
  let view = { scale: 1, x: 0, y: 0 };
  for (let index = 0; index < 20; index += 1) view = zoomAt(view, 2, 400, 300, 400, 300);
  assert.equal(view.scale, MAX_SCALE);
  assert.equal(view.x, 400 * (1 - MAX_SCALE));
  assert.deepEqual(zoomAt(view, 0.0001, 0, 0, 400, 300), { scale: 1, x: 0, y: 0 });
});

test("a pan stops at the edge of the image", () => {
  const view = clampView({ scale: 2, x: -100, y: -100 }, 400, 300);
  assert.deepEqual(panBy(view, 1000, 1000, 400, 300), { scale: 2, x: 0, y: 0 });
  assert.deepEqual(panBy(view, -1000, -1000, 400, 300), { scale: 2, x: -400, y: -300 });
});

test("the state of a frame is one of the four texts", () => {
  assert.deepEqual(frameStateKey(frame()), { key: "deep.state.waiting" });
  assert.deepEqual(frameStateKey(frame({ weight: 0.125 })), { key: "deep.state.weight", percent: 12.5 });
  assert.deepEqual(frameStateKey(frame({ rejection_reason: "poor_alignment" })), { key: "deep.rejected.poor_alignment" });
  assert.deepEqual(frameStateKey(frame({ weight: 0.5, withdrawn_at: "2026-11-02T00:00:00Z" })), { key: "deep.state.withdrawn" });
});
