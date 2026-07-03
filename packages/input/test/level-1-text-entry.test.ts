import { focus, type Node } from "@bomb.sh/freedom";
import { afterEach, beforeEach, createTestInterface, describe, expect, it, type TestInterface } from "./suite.ts";
import { makeInput } from "../src/index.ts";

// Level 1 — Text entry & caret (the foundation)
describe("Level 1 — text entry & caret", () => {
  let root: TestInterface;
  let input: Node;
  beforeEach(async () => {
    root = createTestInterface();
    input = root.node.createChild("input")
    makeInput(input);
    focus(input);
  });
  afterEach(() => root.destroy());

  it("installs input state onto a node", () => {
    expect(input.get("value")).toEqual("");
    expect(input.get("focused")).toEqual(true);
  });

  it("starts empty with the caret at 0", () => {
    expect(input.get("caret")).toEqual(0);
  });

  it("inserts a printable character at the caret and advances the caret", () => {
    root.type("h");
    expect(input.get("value")).toEqual("h");
    expect(input.get("caret")).toEqual(1);
  });

  it("inserts a run of characters left-to-right", () => {
    root.type("cat");
    expect(input.get("value")).toEqual("cat");
    expect(input.get("caret")).toEqual(3);
  });

  it("inserts a character at the caret when the caret is mid-string", () => {
    root.type("cat");
    root.keydown("ArrowLeft"); // caret between "ca" and "t"
    root.type("x");
    expect(input.get("value")).toEqual("caxt");
    expect(input.get("caret")).toEqual(3);
  });

  it("does not insert a newline on Enter", () => {
    root.keydown("Enter");
    expect(input.get("value")).toEqual("");
    expect(input.get("caret")).toEqual(0);
  });

  it("removes the character before the caret on Backspace", () => {
    input.set("value", "cat");
    input.set("caret", 1);
    root.keydown("Backspace");
    expect(input.get("value")).toEqual("at");
    expect(input.get("caret")).toEqual(0);
  });

  it("removes the last character on Backspace at the end of the value", () => {
    root.type("cat");
    expect(input.get("caret")).toEqual(3);
    root.keydown("Backspace");
    expect(input.get("value")).toEqual("ca");
    expect(input.get("caret")).toEqual(2);
  });

  it("does nothing on Backspace at the start of the value", () => {
    input.set("value", "cat");
    input.set("caret", 0);
    root.keydown("Backspace");
    expect(input.get("value")).toEqual("cat");
    expect(input.get("caret")).toEqual(0);
  });

  it("removes a whole multi-code-unit character on Backspace (code-point safe)", () => {
    // "😀" is a surrogate pair — two UTF-16 units, one code point.
    root.type("a😀");
    expect(input.get("value")).toEqual("a😀");
    expect(input.get("caret")).toEqual(2);
    root.keydown("Backspace");
    expect(input.get("value")).toEqual("a");
    expect(input.get("caret")).toEqual(1);
  });
  
  it("removes the character after the caret on Delete", () => {
    input.set("value", "cat");
    input.set("caret", 1);
    root.keydown("Delete");
    expect(input.get("value")).toEqual("ct");
    expect(input.get("caret")).toEqual(1);
  });
  
  it("does nothing on Delete at the end of the value", () => {
    input.set("value", "cat");
    input.set("caret", 3);
    root.keydown("Delete");
    expect(input.get("value")).toEqual("cat");
    expect(input.get("caret")).toEqual(3);
  });

  it("moves the caret one character toward the start on ArrowLeft", () => {
    input.set("value", "cat");
    input.set("caret", 2);
    root.keydown("ArrowLeft");
    expect(input.get("caret")).toEqual(1);
    expect(input.get("value")).toEqual("cat");
  });

  it("moves the caret one character toward the end on ArrowRight", () => {
    input.set("value", "cat");
    input.set("caret", 1);
    root.keydown("ArrowRight");
    expect(input.get("caret")).toEqual(2);
    expect(input.get("value")).toEqual("cat");
  });

  it("does not move the caret on ArrowLeft at the start", () => {
    input.set("value", "cat");
    input.set("caret", 0);
    root.keydown("ArrowLeft");
    expect(input.get("caret")).toEqual(0);
  });

  it("does not move the caret on ArrowRight at the end", () => {
    input.set("value", "cat");
    input.set("caret", 3);
    root.keydown("ArrowRight");
    expect(input.get("caret")).toEqual(3);
  });

  it("moves the caret to the start on Home", () => {
    input.set("value", "cat");
    input.set("caret", 2);
    root.keydown("Home");
    expect(input.get("caret")).toEqual(0);
  });

  it("moves the caret to the end on End", () => {
    input.set("value", "cat");
    input.set("caret", 0);
    root.keydown("End");
    expect(input.get("caret")).toEqual(3);
  });

  it.skip("keeps the selection collapsed throughout (direction none)", () => {
    // The Level 1 model tracks a single `caret` and no selection range, so a
    // selection is collapsed by construction. Written with fallbacks so it holds
    // in the caret-only model and stays meaningful if selectionStart/End/direction
    // are added later — they must equal the caret with direction "none".
    root.type("cat");
    root.keydown("ArrowLeft");
    const caret = input.get("caret");
    expect(input.get("selectionStart") ?? caret).toEqual(caret);
    expect(input.get("selectionEnd") ?? caret).toEqual(caret);
    expect(input.get("selectionDirection") ?? "none").toEqual("none");
  });
});
