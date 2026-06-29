import { describe, expect, it } from "../test/suite.ts";
import { createRoot, NodeApi } from "../src/index.ts";

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

  it("a sync interceptor (scope.around NodeApi) transforms a mutation", () => {
    const root = createRoot();
    root.node.scope.around(NodeApi, {
      set([node, key, value], next) {
        next(node, key, typeof value === "number" ? value * 10 : value);
      },
    });

    root.node.set("n", 5);
    expect(root.node.props["n"]).toEqual(50);

    // interceptor is inherited by descendants via the scope chain
    const child = root.node.createChild("c");
    child.set("m", 2);
    expect(child.props["m"]).toEqual(20);

    root.destroy();
  });
});
