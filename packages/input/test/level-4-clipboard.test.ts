import { describe, it } from "./suite.ts";

// Level 4 — Clipboard & kill
//
// Cut / copy / paste and kill / yank operate against an injectable buffer; there
// is no OS clipboard integration yet.
describe("Level 4 — clipboard & kill", () => {
  it.skip("copy captures the selected text without changing the value");
  it.skip("copy with a collapsed selection captures nothing");
  it.skip("cut captures the selected text and removes it, collapsing to the start");
  it.skip("paste inserts captured text at the caret");
  it.skip("paste replaces the current selection");
  it.skip("kill-to-end removes from the caret to the end and captures it");
  it.skip("kill-to-start removes from the start of the value to the caret and captures it");
  it.skip("yank re-inserts the most recently killed or cut text");
});
