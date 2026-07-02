import { describe, it } from "./suite.ts";

// Level 2 — Selection
//
// The selection can span a range. `selectionDirection` records which edge is
// the anchor. Editing over a selection replaces or removes the whole range.
describe("Level 2 — selection", () => {
  it.skip("shift+right extends the selection one character toward the end");
  it.skip("shift+left extends the selection one character toward the start");
  it.skip("shift+home extends the selection to the start");
  it.skip("shift+end extends the selection to the end");
  it.skip("select-all selects the entire value");
  it.skip("extending from a caret sets the direction");
  it.skip("extending past the anchor flips the direction");
  it.skip("a plain right collapses a selection to its end");
  it.skip("a plain left collapses a selection to its start");
  it.skip("home / end collapse the selection");
  it.skip("typing a character replaces the selection");
  it.skip("backspace deletes the selection, leaving the caret at the start");
  it.skip("delete deletes the selection, leaving the caret at the start");
});
