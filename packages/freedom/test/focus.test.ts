import { describe, expect, it } from "../test/suite.ts";
import {
  advance,
  createRoot,
  current,
  focus,
  focusable,
  focusPush,
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

describe("Focus stack (§12)", () => {
  it("push seeds the first focusable descendant of the pushed node", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const modal = root.node.createChild("modal");
    const m1 = modal.createChild("m1");
    focusable(m1);
    focusable(modal.createChild("m2"));
    useFocus(root.node); // seeds A
    focusPush(modal);
    expect(current(root.node)).toBe(m1);
    root.destroy();
  });

  it("forward cycling is contained within the pushed node", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    focusable(root.node.createChild("B"));
    const modal = root.node.createChild("modal");
    focusable(modal.createChild("m1"));
    focusable(modal.createChild("m2"));
    useFocus(root.node);
    focusPush(modal); // seeds m1
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(current(root.node).name);
      advance(root.node);
    }
    expect(names).toEqual(["m1", "m2", "m1", "m2"]); // never A/B
    root.destroy();
  });

  it("backward cycling is contained within the pushed node", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const modal = root.node.createChild("modal");
    focusable(modal.createChild("m1"));
    focusable(modal.createChild("m2"));
    useFocus(root.node);
    focusPush(modal); // seeds m1
    retreat(root.node); // m1 -> m2 (wrap within modal)
    expect(current(root.node).name).toEqual("m2");
    retreat(root.node); // m2 -> m1
    expect(current(root.node).name).toEqual("m1");
    root.destroy();
  });

  it("pop restores focus to the pre-push node", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const b = root.node.createChild("B");
    focusable(b);
    const modal = root.node.createChild("modal");
    focusable(modal.createChild("m1"));
    useFocus(root.node); // seeds A
    advance(root.node); // A -> B; B is the pre-push focus
    const pop = focusPush(modal); // seeds m1
    expect(current(root.node).name).toEqual("m1");
    pop();
    expect(current(root.node)).toBe(b); // restored
    root.destroy();
  });

  it("pop invokes the callback once, with the value, after focus is restored", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const modal = root.node.createChild("modal");
    focusable(modal.createChild("m1"));
    useFocus(root.node); // seeds A
    const calls: Array<{ value: unknown; focused: string }> = [];
    const pop = focusPush(modal, (value) => {
      calls.push({ value, focused: current(root.node).name });
    });
    pop("4242");
    expect(calls).toEqual([{ value: "4242", focused: "A" }]); // restore happened first
    root.destroy();
  });

  it("focus() on a node outside the active focus root throws", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    const modal = root.node.createChild("modal");
    focusable(modal.createChild("m1"));
    useFocus(root.node);
    focusPush(modal);
    expect(() => focus(a)).toThrow(); // A is outside the modal
    root.destroy();
  });

  it("focus() on a node inside the active focus root works", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const modal = root.node.createChild("modal");
    focusable(modal.createChild("m1"));
    const m2 = modal.createChild("m2");
    focusable(m2);
    useFocus(root.node);
    focusPush(modal); // seeds m1
    focus(m2);
    expect(current(root.node)).toBe(m2);
    root.destroy();
  });

  it("popping the same push twice is an unbalanced-pop error", () => {
    const root = createRoot();
    const modal = root.node.createChild("modal");
    focusable(modal.createChild("m1"));
    useFocus(root.node);
    const pop = focusPush(modal);
    pop();
    expect(() => pop()).toThrow(); // already popped
    root.destroy();
  });

  it("nesting: inner cycling is contained; popping inner returns to outer containment", () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const outer = root.node.createChild("outer");
    focusable(outer.createChild("o1"));
    focusable(outer.createChild("o2"));
    const inner = outer.createChild("inner");
    focusable(inner.createChild("i1"));
    focusable(inner.createChild("i2"));
    useFocus(root.node); // seeds A
    focusPush(outer); // seeds o1
    const popInner = focusPush(inner); // seeds i1
    const innerNames: string[] = [];
    for (let i = 0; i < 3; i++) {
      innerNames.push(current(root.node).name);
      advance(root.node);
    }
    expect(innerNames).toEqual(["i1", "i2", "i1"]); // contained to inner
    popInner();
    expect(current(root.node).name).toEqual("o1"); // back inside outer
    advance(root.node);
    expect(current(root.node).name).toEqual("o2"); // outer containment
    root.destroy();
  });

  it("current() falls back to the pushed node when it has no focusable descendant", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    focusable(a);
    const modal = root.node.createChild("modal"); // no focusable children
    useFocus(root.node); // seeds A
    focusPush(modal);
    expect(current(root.node)).toBe(modal); // fallback to container
    expect(a.props.focused).toBe(false); // pre-push focus cleared
    root.destroy();
  });

  it("removing the focused node keeps focus within the container", async () => {
    const root = createRoot();
    focusable(root.node.createChild("A"));
    const modal = root.node.createChild("modal");
    const m1 = modal.createChild("m1");
    focusable(m1);
    focusable(modal.createChild("m2"));
    useFocus(root.node);
    focusPush(modal); // seeds m1
    await m1.remove();
    expect(current(root.node).name).toEqual("m2"); // successor within modal
    root.destroy();
  });
});
