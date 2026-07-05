import { focus, type Node } from "@bomb.sh/freedom";
import {
  afterEach,
  beforeEach,
  createTestInterface,
  describe,
  expect,
  it,
  type TestInterface,
} from "./suite.ts";
import { initInput } from "../src/index.ts";
import { useReadlineKeymap } from "../src/lib/readline-layout.ts";

// Readline/emacs keymap — control-key aliases layered on the base bindings:
//   Ctrl+A → Home        Ctrl+E → End
//   Ctrl+B → ArrowLeft   Ctrl+F → ArrowRight
//   Ctrl+D → Delete
// Each spec asserts the alias produces the same effect as the key it stands in
// for. `root.keydown(code, { ctrl: true })` sends the modifier.
describe("readline keymap", () => {
  let root: TestInterface;
  let input: Node;
  beforeEach(async () => {
    root = createTestInterface();
    useReadlineKeymap(root.node);
    input = root.node.createChild("input");
    initInput(input);
    focus(input);
  });
  afterEach(() => root.destroy());

  it("moves the caret to the start on Ctrl+A", () => {
    input.set("value", "cat");
    input.set("caret", 2);
    root.keydown("a", { ctrl: true });
    expect(input.get("caret")).toEqual(0);
  });

  it("moves the caret to the end on Ctrl+E", () => {
    input.set("value", "cat");
    input.set("caret", 0);
    root.keydown("e", { ctrl: true });
    expect(input.get("caret")).toEqual(3);
  });

  it("moves the caret one character toward the end on Ctrl+F", () => {
    input.set("value", "cat");
    input.set("caret", 1);
    root.keydown("f", { ctrl: true });
    expect(input.get("caret")).toEqual(2);
  });

  it("moves the caret one character toward the start on Ctrl+B", () => {
    input.set("value", "cat");
    input.set("caret", 2);
    root.keydown("b", { ctrl: true });
    expect(input.get("caret")).toEqual(1);
  });

  it("removes the character after the caret on Ctrl+D", () => {
    input.set("value", "cat");
    input.set("caret", 1);
    root.keydown("d", { ctrl: true });
    expect(input.get("value")).toEqual("ct");
    expect(input.get("caret")).toEqual(1);
  });
});
