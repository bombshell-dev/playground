import { describe, it } from "./suite.ts";

// Level 5 — Undo / redo
//
// An undo step captures value and selection. Consecutive insertions coalesce;
// caret- and selection-only changes are not undoable.
describe("Level 5 — undo / redo", () => {
  it.skip("undo restores value and selection to before the last edit");
  it.skip("redo re-applies an undone edit");
  it.skip("a fresh edit after undo clears the redo stack");
  it.skip("consecutive insertions coalesce into one undo step");
  it.skip("a deletion is its own undo step");
  it.skip("caret-only moves create no undo step");
  it.skip("selection-only changes create no undo step");
});
