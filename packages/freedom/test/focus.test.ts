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
  it("seeds the first focusable descendant", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    focusable(root.node.createChild("B"));
    useFocus(root.node);
    expect(current(root.node)).toBe(a);
    expect(a.props.focused).toBe(true);
    root.destroy();
  });

  it("focuses nothing on an empty container; current falls back to root", () => {
    const root = createRoot();
    useFocus(root.node);
    expect(current(root.node)).toBe(root.node);
    expect(root.node.props.focused).toBe(undefined);
    root.destroy();
  });

  it("does not enroll root in the ring", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    focusable(root.node.createChild("B"));
    useFocus(root.node); // seeds A
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      names.push(current(root.node).name);
      advance(root.node);
    }
    expect(names).toEqual(["A", "B", "A"]); // wraps A->B->A; root never appears
    root.destroy();
  });

  it("escape hatch: explicit focusable(root) keeps root in the ring", () => {
    const root = createRoot();
    focusable(root.node); // explicit enrollment
    const a = root.node.createChild("A");
    focusable(a);
    useFocus(root.node); // seeds A (first descendant, skipping root)
    expect(current(root.node)).toBe(a);
    advance(root.node); // A -> root (wrap now includes root)
    expect(current(root.node)).toBe(root.node);
    root.destroy();
  });
});

describe("focusable()", () => {
  it("sets focused:false on the node", () => {
    const root = createRoot();
    const child = root.node.createChild("child");
    focusable(child);
    expect(child.props.focused).toBe(false);
    root.destroy();
  });

  it("is a no-op on an already-focusable node", () => {
    const root = createRoot();
    const child = root.node.createChild("child");
    focusable(child);
    focusable(child);
    expect(child.props.focused).toBe(false);
    root.destroy();
  });

  it("a node without focusable is skipped by the chain", () => {
    const root = createRoot();
    root.node.createChild("skip"); // not focusable
    const here = root.node.createChild("here");
    focusable(here);
    useFocus(root.node); // seeds "here", skipping "skip"
    expect(current(root.node).name).toEqual("here");
    root.destroy();
  });
});

describe("Focus chain", () => {
  it("depth-first order, flat children", () => {
    const root = createRoot();
    for (const name of ["A", "B", "C"]) {
      focusable(root.node.createChild(name));
    }
    useFocus(root.node); // seeds A
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(current(root.node).name);
      advance(root.node);
    }
    expect(names).toEqual(["A", "B", "C", "A"]);
    root.destroy();
  });

  it("depth-first order, nested children", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    focusable(a.createChild("A1"));
    focusable(root.node.createChild("B"));
    useFocus(root.node); // seeds A
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(current(root.node).name);
      advance(root.node);
    }
    expect(names).toEqual(["A", "A1", "B", "A"]);
    root.destroy();
  });
});

describe("advance()", () => {
  it("moves focus forward", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    const b = root.node.createChild("B");
    focusable(b);
    useFocus(root.node); // seeds A
    expect(a.props.focused).toBe(true);
    advance(root.node); // A -> B
    expect(a.props.focused).toBe(false);
    expect(b.props.focused).toBe(true);
    root.destroy();
  });

  it("wraps from last to first", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    const b = root.node.createChild("B");
    focusable(b);
    useFocus(root.node); // seeds A
    advance(root.node); // A -> B
    advance(root.node); // B -> A (wrap)
    expect(current(root.node)).toBe(a);
    root.destroy();
  });

  it("single focusable node is a no-op", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    useFocus(root.node); // seeds A
    advance(root.node); // no-op (chain length 1)
    expect(current(root.node)).toBe(a);
    root.destroy();
  });

  it("nothing focused is a no-op", () => {
    const root = createRoot();
    useFocus(root.node); // empty container
    advance(root.node);
    expect(current(root.node)).toBe(root.node);
    root.destroy();
  });
});

describe("retreat()", () => {
  it("moves focus backward", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    focusable(root.node.createChild("B"));
    useFocus(root.node); // seeds A
    advance(root.node); // A -> B
    expect(current(root.node).name).toEqual("B");
    retreat(root.node); // B -> A
    expect(current(root.node).name).toEqual("A");
    root.destroy();
  });

  it("wraps from first to last", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const b = root.node.createChild("B");
    focusable(b);
    useFocus(root.node); // seeds A
    retreat(root.node); // A -> B (wrap to last)
    expect(current(root.node)).toBe(b);
    root.destroy();
  });
});

describe("focus(node)", () => {
  it("explicitly focuses a node", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    const b = root.node.createChild("B");
    focusable(b);
    useFocus(root.node); // seeds A
    focus(b);
    expect(current(root.node)).toBe(b);
    expect(a.props.focused).toBe(false);
    expect(b.props.focused).toBe(true);
    root.destroy();
  });

  it("throws on a non-focusable node", () => {
    const root = createRoot();
    const child = root.node.createChild("nope");
    useFocus(root.node);
    expect(() => focus(child)).toThrow();
    root.destroy();
  });

  it("is a no-op when already focused", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    useFocus(root.node); // seeds A
    focus(a); // already focused -> no-op
    expect(current(root.node)).toBe(a);
    root.destroy();
  });
});

describe("Focused node removal", () => {
  it("removing the focused node advances focus", async () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    focusable(root.node.createChild("B"));
    useFocus(root.node); // seeds A
    expect(a.props.focused).toBe(true);
    await a.remove();
    expect(current(root.node).name).toEqual("B");
    root.destroy();
  });

  it("removing a non-focused node does not move focus", async () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const b = root.node.createChild("B");
    focusable(b);
    useFocus(root.node); // seeds A
    await b.remove();
    expect(current(root.node).name).toEqual("A");
    root.destroy();
  });
});
