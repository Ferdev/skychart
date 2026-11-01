import assert from "node:assert/strict";
import { test } from "node:test";
import { chipKey, factText, formatFact, pollStep, POLL_LIMIT_MS, sentenceText, speechText, type NarrationSentence } from "../src/community/flightNarration.ts";
import { ANSWER_FLIGHT_TRANSLATIONS } from "../src/i18n/answerFlightTranslations.ts";

const label = (unit: string) => ({ ly: "light-years", au: "AU" })[unit] ?? unit;
const sentence: NarrationSentence = [
  { kind: "object", key: "ngc-224", text: "Andromeda Galaxy" },
  { kind: "text", text: " is " },
  { kind: "fact", value: 2_537_000, unit: "ly", keys: ["ngc-224"] },
  { kind: "text", text: " away." },
];

test("a large value is a word in the language of the reader", () => {
  assert.equal(formatFact(2_537_000, "en"), "2.537 million");
  assert.equal(formatFact(2_537_000, "es"), "2,537 millones");
  assert.equal(formatFact(1.524, "de"), "1,524");
  assert.equal(formatFact(149_597_870.7, "en"), "149.6 million");
});

test("a chip has the number and the unit", () => {
  assert.equal(factText({ value: 1.5, unit: "au" }, "en", label), "1.5 AU");
  assert.equal(factText({ value: 8, unit: "" }, "en", label), "8");
});

test("a sentence and the speech read the same text", () => {
  assert.equal(sentenceText(sentence, "en", label), "Andromeda Galaxy is 2.537 million light-years away.");
  assert.equal(speechText("The neighbour", [sentence], "en", label), "The neighbour. Andromeda Galaxy is 2.537 million light-years away.");
});

test("a chip opens the record of its value", () => {
  assert.equal(chipKey(sentence[0]!), "ngc-224");
  assert.equal(chipKey(sentence[1]!), null);
  assert.equal(chipKey(sentence[2]!), "ngc-224");
  assert.equal(chipKey({ kind: "fact", value: 1, unit: "", keys: [] }), null);
});

test("the wait ends with a result or at the limit", () => {
  assert.equal(pollStep("queued", 0), "wait");
  assert.equal(pollStep("running", POLL_LIMIT_MS - 1), "wait");
  assert.equal(pollStep("running", POLL_LIMIT_MS), "timeout");
  assert.equal(pollStep("published", POLL_LIMIT_MS), "play");
  assert.equal(pollStep("refused", 0), "refuse");
  assert.equal(pollStep("failed", 0), "fail");
});

test("each unit of the verifier has a label in each locale", () => {
  for (const unit of ["ly", "pc", "au", "km", "deg", "min", "h", "s", "mas", "mag"])
    for (const table of Object.values(ANSWER_FLIGHT_TRANSLATIONS)) assert.ok(table[`ask.unit.${unit}`]);
});
