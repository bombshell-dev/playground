import { describe, expect, it } from "../test/suite.ts";
import { run, sleep } from "effection";
import { createRoot, DispatchApi, NodeApi } from "../src/index.ts";

describe("JsonValue validation", () => {
  it("accepts valid JsonValues", () => {
    const root = createRoot();
    const { node } = root;
    node.set("str", "hello");
    node.set("num", 42);
    node.set("zero", 0);
    node.set("neg", -1.5);
    node.set("bool", true);
    node.set("nil", null);
    node.set("arr", [1, "a", true, null]);
    node.set("obj", { a: 1, b: "c" });
    node.set("nested", { nested: { deep: [1, 2] } });
    expect(node.props["str"]).toEqual("hello");
    expect(node.props["nil"]).toEqual(null);
    expect(node.props["nested"]).toEqual({ nested: { deep: [1, 2] } });
    root.destroy();
  });

  it("rejects undefined", () => {
    const root = createRoot();
    expect(() => root.node.set("k", undefined as unknown as null)).toThrow();
    root.destroy();
  });

  it("rejects NaN and Infinity", () => {
    const root = createRoot();
    for (const val of [NaN, Infinity, -Infinity]) {
      expect(() => root.node.set("k", val)).toThrow();
    }
    root.destroy();
  });

  it("rejects non-JSON types", () => {
    const root = createRoot();
    for (const val of [() => {}, Symbol(), new Date(), new Map()]) {
      expect(() => root.node.set("k", val as unknown as null)).toThrow();
    }
    root.destroy();
  });

  it("validates update return values", () => {
    const root = createRoot();
    root.node.set("n", 1);
    root.node.update("n", () => 42);
    expect(root.node.props["n"]).toEqual(42);
    expect(() => root.node.update("n", () => undefined as unknown as number))
      .toThrow();
    root.destroy();
  });
});

describe("Property bag", () => {
  it("set replaces, get reads", () => {
    const root = createRoot();
    const { node } = root;
    node.set("a", 1);
    node.set("a", 2);
    node.set("b", 2);
    expect(node.get("a")).toEqual(2);
    expect(node.props["b"]).toEqual(2);
    root.destroy();
  });

  it("update transforms", () => {
    const root = createRoot();
    root.node.set("n", 1);
    root.node.update("n", (v) => (v as number) + 1);
    expect(root.node.props["n"]).toEqual(2);
    root.destroy();
  });

  it("unset removes the key", () => {
    const root = createRoot();
    root.node.set("a", 1);
    root.node.unset("a");
    expect("a" in root.node.props).toBe(false);
    root.destroy();
  });

  it("unset of a missing key is a no-op", () => {
    const root = createRoot();
    expect(() => root.node.unset("nope")).not.toThrow();
    root.destroy();
  });

  it("props is read-only", () => {
    const root = createRoot();
    root.node.set("x", 1);
    expect(() => {
      (root.node.props as Record<string, number>)["x"] = 2;
    }).toThrow();
    root.destroy();
  });
});

describe("Children and ordering", () => {
  it("createChild appends in insertion order", () => {
    const root = createRoot();
    root.node.createChild("A");
    root.node.createChild("B");
    root.node.createChild("C");
    expect([...root.node.children].map((c) => c.name)).toEqual(["A", "B", "C"]);
    root.destroy();
  });

  it("createChild inserts before a sibling", () => {
    const root = createRoot();
    root.node.createChild("A");
    const c = root.node.createChild("C");
    root.node.createChild("B", { before: c });
    expect([...root.node.children].map((n) => n.name)).toEqual(["A", "B", "C"]);
    root.destroy();
  });

  it("createChild before the first child inserts at the front", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    root.node.createChild("Z", { before: a });
    expect([...root.node.children].map((n) => n.name)).toEqual(["Z", "A"]);
    root.destroy();
  });

  it("createChild throws when before is not a child", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    const stranger = root.node.createChild("B").createChild("nested");
    expect(() => a.createChild("x", { before: stranger })).toThrow();
    root.destroy();
  });

  it("before sets insertion order under an active sort tiebreaker", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    const c = root.node.createChild("C");
    const b = root.node.createChild("B", { before: c });
    for (const n of [a, b, c]) {
      n.set("priority", 1);
    }
    root.node.sort((x, y) =>
      (x.props["priority"] as number) - (y.props["priority"] as number)
    );
    // all equal -> insertion order (with B spliced before C) is the tiebreaker
    expect([...root.node.children].map((n) => n.name)).toEqual(["A", "B", "C"]);
    root.destroy();
  });

  it("custom sort reorders children", () => {
    const root = createRoot();
    const a = root.node.createChild("A");
    const b = root.node.createChild("B");
    const c = root.node.createChild("C");
    a.set("priority", 3);
    b.set("priority", 1);
    c.set("priority", 2);
    root.node.sort((x, y) =>
      (x.props["priority"] as number) - (y.props["priority"] as number)
    );
    expect([...root.node.children].map((n) => n.name)).toEqual(["B", "C", "A"]);
    root.node.sort(undefined);
    expect([...root.node.children].map((n) => n.name)).toEqual(["A", "B", "C"]);
    root.destroy();
  });

  it("child ids are unique and the parent is wired", () => {
    const root = createRoot();
    const a = root.node.createChild("a");
    const b = a.createChild("b");
    expect(b.parent).toBe(a);
    expect(new Set([root.node.id, a.id, b.id]).size).toEqual(3);
    root.destroy();
  });
});

describe("Mutation interception (NodeApi)", () => {
  it("set interceptor can transform values", () => {
    const root = createRoot();
    root.node.scope.around(NodeApi, {
      set([node, key, value], next) {
        next(node, key, key === "doubled" ? (value as number) * 2 : value);
      },
    });
    root.node.set("doubled", 21);
    root.node.set("plain", 5);
    expect(root.node.props["doubled"]).toEqual(42);
    expect(root.node.props["plain"]).toEqual(5);
    root.destroy();
  });

  it("get interceptor can transform reads", () => {
    const root = createRoot();
    root.node.set("k", 1);
    root.node.scope.around(NodeApi, {
      get([node, key], next) {
        const val = next(node, key);
        return key === "k" ? (val as number) * 10 : val;
      },
    });
    expect(root.node.get("k")).toEqual(10);
    root.destroy();
  });

  it("interceptors are inherited by descendants", () => {
    const root = createRoot();
    let appended = 0;
    root.node.scope.around(NodeApi, {
      createChild([node, name], next) {
        appended++;
        return next(node, name);
      },
    });
    const a = root.node.createChild("a");
    a.createChild("b");
    expect(appended).toEqual(2);
    root.destroy();
  });
});

describe("Dispatch and notification", () => {
  it("demux middleware handles an event", async () => {
    await run(function* () {
      const root = createRoot();
      let handled = false;
      root.node.scope.around(DispatchApi, {
        *dispatch([event], next) {
          if (event === "ping") {
            handled = true;
            return { ok: true as const, value: true as const };
          }
          return yield* next(event);
        },
      });
      root.dispatch("ping");
      yield* sleep(0);
      expect(handled).toBe(true);
      yield* root.destroy();
    });
  });

  it("mutations in a dispatch cycle emit one coalesced notification", async () => {
    await run(function* () {
      const root = createRoot();
      root.node.scope.around(DispatchApi, {
        *dispatch([_event], _next) {
          root.node.set("a", 1);
          root.node.set("b", 2);
          root.node.set("c", 3);
          return { ok: true as const, value: true as const };
        },
      });
      const sub = yield* root;
      root.dispatch("multi");
      const next = yield* sub.next();
      expect(next.done).toBe(false);
      expect(root.node.props["a"]).toEqual(1);
      yield* root.destroy();
    });
  });

  it("a no-change dispatch does not notify", async () => {
    await run(function* () {
      const root = createRoot();
      root.node.scope.around(DispatchApi, {
        *dispatch([_event], _next) {
          return { ok: true as const, value: true as const };
        },
      });
      yield* root;
      root.dispatch("noop");
      yield* sleep(0);
      yield* root.destroy();
    });
  });

  it("processes events sequentially", async () => {
    await run(function* () {
      const root = createRoot();
      const order: string[] = [];
      root.node.scope.around(DispatchApi, {
        *dispatch([event], _next) {
          order.push(event as string);
          return { ok: true as const, value: true as const };
        },
      });
      root.dispatch("first");
      root.dispatch("second");
      yield* sleep(0);
      yield* sleep(0);
      expect(order).toEqual(["first", "second"]);
      yield* root.destroy();
    });
  });
});
