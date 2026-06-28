import { describe, expect, it } from "../test/suite.ts";
import { createRoot } from "../src/index.ts";

describe("createRoot", () => {
  it("returns a root with a parentless node that has an id", () => {
    const root = createRoot();
    expect(root.node).toBeTruthy();
    expect(root.node.parent).toBeUndefined();
    expect(root.node.id).toBeTruthy();
    root.destroy();
  });

  it("createChild attaches a child synchronously with a unique id", () => {
    const root = createRoot();
    const a = root.node.createChild("a");
    const b = root.node.createChild("b");

    expect(a.name).toEqual("a");
    expect(a.parent).toBe(root.node);
    expect(a.id).not.toEqual(b.id);
    expect(a.id).not.toEqual(root.node.id);
    expect([...root.node.children]).toEqual([a, b]);

    root.destroy();
  });
});
