import assert from "node:assert/strict";
import { uniqueNowEvents, type NowEvent } from "../src/atlas/nowEvents.ts";

function event(title: string, startsAt: string, url = "/o/x"): NowEvent {
  return { title, summary: "", starts_at: startsAt, url, catalog_key: null };
}

// The same close approach with a corrected time is one row. The first row stays.
{
  const events = [
    event("(2026 TB3) close approach", "2026-10-09T03:12:00Z", "a"),
    event("(2026 TB3) close approach", "2026-10-09T03:47:00Z", "b"),
    event("(2026 TC1) close approach", "2026-10-09T03:47:00Z", "c"),
    event(" (2026 tb3) Close Approach ", "2026-10-09T21:00:00Z", "d"),
    event("(2026 TB3) close approach", "2026-10-10T00:10:00Z", "e"),
  ];
  assert.deepEqual(uniqueNowEvents(events).map((item) => item.url), ["a", "c", "e"]);
}

// The day is the UTC day, also for a time with a zone offset.
assert.equal(uniqueNowEvents([event("Perseids peak", "2026-08-12T23:30:00-02:00"), event("Perseids peak", "2026-08-13T00:30:00Z")]).length, 1);
assert.equal(uniqueNowEvents([event("Perseids peak", "2026-08-12T21:30:00Z"), event("Perseids peak", "2026-08-13T00:30:00Z")]).length, 2);

// A time that is not a date does not stop the function.
assert.equal(uniqueNowEvents([event("Launch", "soon"), event("Launch", "soon"), event("Launch", "later")]).length, 2);
assert.deepEqual(uniqueNowEvents([]), []);

console.log("now events tests passed");
