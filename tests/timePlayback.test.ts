import assert from "node:assert/strict";
import { PLAY_MAX_STEPS, PLAY_MIN_INTERVAL_MS, TimePlayback, type TimePlaybackState } from "../src/atlas/timePlayback.ts";

/** A clock and a timer queue that the test controls. */
function harness() {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const changes: TimePlaybackState[] = [];
  let stepCalls = 0;
  const playback = new TimePlayback({
    step: () => { stepCalls += 1; },
    onChange: (state) => changes.push(state),
    now: () => time,
    setTimer: (callback, milliseconds) => { const id = nextId++; timers.set(id, { at: time + milliseconds, callback }); return id; },
    clearTimer: (handle) => { timers.delete(handle as number); },
  });
  const advance = (milliseconds: number) => {
    const end = time + milliseconds;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      time = due[1].at;
      due[1].callback();
    }
    time = end;
  };
  return { playback, advance, changes, timers, stepCalls: () => stepCalls };
}

assert.equal(PLAY_MIN_INTERVAL_MS, 1_000);
assert.equal(PLAY_MAX_STEPS, 120);

// Play starts one step immediately. The next step waits for the load and for the one-second interval.
{
  const h = harness();
  assert.deepEqual(h.playback.state, { playing: false, steps: 0, pauseReason: null });
  h.playback.play();
  assert.equal(h.stepCalls(), 1);
  assert.equal(h.playback.state.playing, true);
  h.advance(5_000);
  assert.equal(h.stepCalls(), 1, "no new step before the load is complete");

  // A fast load (200 ms): the next step starts one second after the last step started.
  h.playback.play();
  assert.equal(h.stepCalls(), 1, "a second play call does nothing");
  h.playback.loadCompleted();
  assert.equal(h.playback.state.steps, 1);
  assert.equal(h.stepCalls(), 1, "the load took 5 s, so the next step is due now but runs from the timer");
  h.advance(0);
  assert.equal(h.stepCalls(), 2);
  h.advance(200);
  h.playback.loadCompleted();
  h.advance(799);
  assert.equal(h.stepCalls(), 2, "one step for each second maximum");
  h.advance(1);
  assert.equal(h.stepCalls(), 3);

  // A load from a different cause (for example the Now button) is not a completed step.
  h.playback.loadCompleted();
  h.playback.loadCompleted();
  assert.equal(h.playback.state.steps, 3, "two completion calls for one step count one time");

  // Pause stops the timer.
  h.playback.pause();
  assert.deepEqual(h.playback.state, { playing: false, steps: 3, pauseReason: "user" });
  assert.equal(h.timers.size, 0);
  h.advance(10_000);
  assert.equal(h.stepCalls(), 3);
  h.playback.loadCompleted();
  assert.equal(h.playback.state.steps, 3);

  // Play after a pause starts the count again.
  h.playback.toggle();
  assert.deepEqual(h.playback.state, { playing: true, steps: 0, pauseReason: null });
  assert.equal(h.stepCalls(), 4);
  h.playback.toggle();
  assert.equal(h.playback.state.playing, false);
}

// Automatic pause after 120 steps.
{
  const h = harness();
  h.playback.play();
  for (let step = 1; step <= PLAY_MAX_STEPS; step += 1) {
    assert.equal(h.playback.state.playing, true, `step ${step}`);
    h.advance(300);
    h.playback.loadCompleted();
    h.advance(PLAY_MIN_INTERVAL_MS);
  }
  assert.deepEqual(h.playback.state, { playing: false, steps: PLAY_MAX_STEPS, pauseReason: "limit" });
  assert.equal(h.stepCalls(), PLAY_MAX_STEPS, "no step starts after the limit");
  assert.equal(h.timers.size, 0);
}

// Automatic pause on an error and on a hidden tab. Play does not start again when the tab shows again.
{
  const h = harness();
  h.playback.play();
  h.playback.loadFailed();
  assert.deepEqual(h.playback.state, { playing: false, steps: 0, pauseReason: "error" });

  h.playback.play();
  h.playback.loadCompleted();
  h.playback.visibilityChanged(true);
  assert.deepEqual(h.playback.state, { playing: false, steps: 1, pauseReason: "hidden" });
  h.playback.visibilityChanged(false);
  h.advance(5_000);
  assert.equal(h.playback.state.playing, false);
  assert.equal(h.stepCalls(), 2);

  // Each state change is reported.
  assert.deepEqual(h.changes.map((state) => `${state.playing}:${state.steps}:${state.pauseReason}`), [
    "true:0:null", "false:0:error", "true:0:null", "true:1:null", "false:1:hidden",
  ]);
}

console.log("time playback tests passed");
