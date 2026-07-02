import { describe, it } from "./suite.ts";

// Level 3 — Word-wise motion & deletion
//
// Motion and deletion operate over word boundaries. Word deletion collapses to
// deleting the selection when one is present.
describe("Level 3 — word-wise motion & deletion", () => {
  it.skip("word-left moves the caret to the previous word boundary");
  it.skip("word-right moves the caret to the next word boundary");
  it.skip("word motion skips whitespace before landing on a word edge");
  it.skip("word-left at the start clamps");
  it.skip("word-right at the end clamps");
  it.skip("shift+word-left extends the selection by a word");
  it.skip("shift+word-right extends the selection by a word");
  it.skip("delete-word-backward removes to the previous word boundary");
  it.skip("delete-word-forward removes to the next word boundary");
  it.skip("word deletion over a selection deletes the selection instead");
});
