import assert from "node:assert/strict";
import { isOptionListKey, nextOptionIndex } from "../src/destination/optionListKeyboard.ts";

assert.equal(isOptionListKey("ArrowDown"), true);
assert.equal(isOptionListKey("End"), true);
assert.equal(isOptionListKey("Enter"), false);

// No active option: Arrow Down goes to the first option and Arrow Up to the last.
assert.equal(nextOptionIndex(5, -1, "ArrowDown"), 0);
assert.equal(nextOptionIndex(5, -1, "ArrowUp"), 4);

// The list does not wrap.
assert.equal(nextOptionIndex(5, 0, "ArrowDown"), 1);
assert.equal(nextOptionIndex(5, 4, "ArrowDown"), 4);
assert.equal(nextOptionIndex(5, 3, "ArrowUp"), 2);
assert.equal(nextOptionIndex(5, 0, "ArrowUp"), 0);
assert.equal(nextOptionIndex(5, 2, "Home"), 0);
assert.equal(nextOptionIndex(5, 2, "End"), 4);

// One option and no options.
assert.equal(nextOptionIndex(1, -1, "ArrowUp"), 0);
assert.equal(nextOptionIndex(1, 0, "ArrowDown"), 0);
assert.equal(nextOptionIndex(0, -1, "ArrowDown"), -1);
assert.equal(nextOptionIndex(0, 3, "End"), -1);

console.log("option list keyboard tests passed");
