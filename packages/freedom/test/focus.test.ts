import { describe, expect, it } from "../test/suite.ts";
import {
  advance,
  createRoot,
  current,
  focus,
  focusable,
  retreat,
  useFocus,
} from "../src/index.ts";

describe("Focus installation", () => {
  it("useFocus sets root as focused", () => {
    const root = createRoot();
    useFocus(root.node);
    expect(current(root.node)).toBe(root.node);
    expect(root.node.props.focused).toBe(true);
    root.destroy();
  });
});

describe("focusable()", () => {
  it("sets focused:false on the node", () => {
    const root = createRoot();
    useFocus(root.node);
    const child = root.node.createChild("child");
    focusable(child);
    expect(child.props.focused).toBe(false);
    root.destroy();
  });

  it("is a no-op on an already-focusable node", () => {
    const root = createRoot();
    useFocus(root.node);
    const child = root.node.createChild("child");
    focusable(child);
    focusable(child);
    expect(child.props.focused).toBe(false);
    root.destroy();
  });

  it("a node without focusable is skipped by the chain", () => {
    const root = createRoot();
    useFocus(root.node);
    root.node.createChild("skip");
    focusable(root.node.createChild("here"));
    advance(root.node); // root -> here, skipping "skip"
    expect(current(root.node).name).toEqual("here");
    root.destroy();
  });
});

describe("Focus chain", () => {
  it("depth-first order, flat children", () => {
    const root = createRoot();
    useFocus(root.node);
    for (const name of ["A", "B", "C"]) {
      focusable(root.node.createChild(name));
    }
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(current(root.node).name);
      advance(root.node);
    }
    expect(names).toEqual(["", "A", "B", "C"]);
    root.destroy();
  });

  it("depth-first order, nested children", () => {
    const root = createRoot();
    useFocus(root.node);
    const a = root.node.createChild("A");
    focusable(a);
    focusable(a.createChild("A1"));
    focusable(root.node.createChild("B"));
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(current(root.node).name);
      advance(root.node);
    }
    expect(names).toEqual(["", "A", "A1", "B"]);
    root.destroy();
  });
});

describe("advance()", () => {
  it("moves focus forward", () => {
    const root = createRoot();
    useFocus(root.node);
    const a = root.node.createChild("A");
    focusable(a);
    expect(root.node.props.focused).toBe(true);
    advance(root.node);
    expect(root.node.props.focused).toBe(false);
    expect(a.props.focused).toBe(true);
    root.destroy();
  });

  it("wraps from last to first (root)", () => {
    const root = createRoot();
    useFocus(root.node);
    focusable(root.node.createChild("A"));
    advance(root.node); // root -> A
    advance(root.node); // A -> root
    expect(current(root.node)).toBe(root.node);
    root.destroy();
  });

  it("single focusable node is a no-op", () => {
    const root = createRoot();
    useFocus(root.node);
    advance(root.node);
    expect(current(root.node)).toBe(root.node);
    root.destroy();
  });
});

describe("retreat()", () => {
  it("moves focus backward", () => {
    const root = createRoot();
    useFocus(root.node);
    focusable(root.node.createChild("A"));
    focusable(root.node.createChild("B"));
    advance(root.node); // root -> A
    advance(root.node); // A -> B
    expect(current(root.node).name).toEqual("B");
    retreat(root.node); // B -> A
    expect(current(root.node).name).toEqual("A");
    root.destroy();
  });

  it("wraps from first to last", () => {
    const root = createRoot();
    useFocus(root.node);
    focusable(root.node.createChild("A"));
    const b = root.node.createChild("B");
    focusable(b);
    retreat(root.node); // root -> B (last)
    expect(current(root.node)).toBe(b);
    root.destroy();
  });
});

describe("focus(node)", () => {
  it("explicitly focuses a node", () => {
    const root = createRoot();
    useFocus(root.node);
    focusable(root.node.createChild("A"));
    const b = root.node.createChild("B");
    focusable(b);
    focus(b);
    expect(current(root.node)).toBe(b);
    expect(root.node.props.focused).toBe(false);
    expect(b.props.focused).toBe(true);
    root.destroy();
  });

  it("throws on a non-focusable node", () => {
    const root = createRoot();
    useFocus(root.node);
    const child = root.node.createChild("nope");
    expect(() => focus(child)).toThrow();
    root.destroy();
  });

  it("is a no-op when already focused", () => {
    const root = createRoot();
    useFocus(root.node);
    focus(root.node);
    expect(current(root.node)).toBe(root.node);
    root.destroy();
  });
});

describe("Focused node removal", () => {
  it("removing the focused node advances focus", async () => {
    const root = createRoot();
    useFocus(root.node);
    const a = root.node.createChild("A");
    focusable(a);
    focusable(root.node.createChild("B"));
    focus(a);
    expect(a.props.focused).toBe(true);

    await a.remove();
    expect(current(root.node).name).toEqual("B");
    root.destroy();
  });

  it("removing a non-focused node does not move focus", async () => {
    const root = createRoot();
    useFocus(root.node);
    focusable(root.node.createChild("A"));
    const b = root.node.createChild("B");
    focusable(b);

    await b.remove();
    expect(current(root.node)).toBe(root.node);
    root.destroy();
  });
});
