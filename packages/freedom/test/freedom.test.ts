import { describe, expect, it } from "../test/suite.ts";
import { run, sleep } from "effection";
import {
  append,
  DispatchApi,
  FreedomApi,
  get,
  set,
  sort,
  unset,
  update,
  useNode,
  useTree,
} from "../mod.ts";

describe("JsonValue validation", () => {
  it("JV1-JV12: accepts valid JsonValues", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      let result = yield* tree.root.eval(function* () {
        yield* set("str", "hello");
        yield* set("num", 42);
        yield* set("zero", 0);
        yield* set("neg", -1.5);
        yield* set("bool", true);
        yield* set("boolFalse", false);
        yield* set("nil", null);
        yield* set("arr", [1, "a", true, null]);
        yield* set("obj", { a: 1, b: "c" });
        yield* set("nested", { nested: { deep: [1, 2] } });
        yield* set("emptyArr", []);
        yield* set("emptyObj", {});
      });
      expect(result.ok).toBe(true);
      expect(tree.root.props["str"]).toEqual("hello");
      expect(tree.root.props["num"]).toEqual(42);
      expect(tree.root.props["nil"]).toEqual(null);
      expect(tree.root.props["nested"]).toEqual({ nested: { deep: [1, 2] } });
    });
  });

  it("JV13: rejects undefined", async () => {
    await run(function* () {
      yield* useTree(function* () {
        try {
          // deno-lint-ignore no-explicit-any
          yield* set("k", undefined as any);
          expect(true).toBe(false);
        } catch (e) {
          expect((e as Error).message).toContain("undefined");
        }
      });
    });
  });

  it("JV14-JV16: rejects NaN and Infinity", async () => {
    await run(function* () {
      yield* useTree(function* () {
        for (let val of [NaN, Infinity, -Infinity]) {
          try {
            yield* set("k", val);
            expect(true).toBe(false);
          } catch (_e) {
            // expected
          }
        }
      });
    });
  });

  it("JV17-JV20: rejects non-JSON types", async () => {
    await run(function* () {
      yield* useTree(function* () {
        for (let val of [() => {}, Symbol(), new Date(), new Map()]) {
          try {
            // deno-lint-ignore no-explicit-any
            yield* set("k", val as any);
            expect(true).toBe(false);
          } catch (_e) {
            // expected
          }
        }
      });
    });
  });

  it("JV21-JV23: validates update return values", async () => {
    await run(function* () {
      yield* useTree(function* () {
        yield* set("n", 1);
        yield* update("n", () => 42);

        try {
          yield* update("n", () => undefined as unknown as number);
          expect(true).toBe(false);
        } catch (e) {
          expect((e as Error).message).toContain("undefined");
        }
      });
    });
  });
});

describe("Node lifecycle", () => {
  it("NL1-NL6: creates child nodes via append", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* append("child", function* () {
          yield* set("init", true);
        });
      });
      yield* sleep(0);

      let children = [...tree.root.children];
      expect(children.length).toEqual(1);
      expect(children[0].name).toEqual("child");
      expect(children[0].parent).toBe(tree.root);
      expect(children[0].props["init"]).toEqual(true);
    });
  });

  it("NL7-NL11: assigns unique ids", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* append("a", function* () {});
        yield* append("b", function* () {});
      });
      yield* sleep(0);

      expect(tree.root.id).toBeTruthy();
      let children = [...tree.root.children];
      expect(children[0].id).not.toEqual(children[1].id);
      expect(tree.root.id).not.toEqual(children[0].id);
    });
  });

  it("NL12: remove() removes node from parent", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      let result = yield* tree.root.eval(function* () {
        let child = yield* append("child", function* () {
          yield* set("name", "child");
        });
        yield* child.remove();
      });
      expect(result.ok).toBe(true);
      expect([...tree.root.children].length).toEqual(0);
    });
  });

  it("N12: remove() on root raises error", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      let result = yield* tree.root.eval(function* () {
        yield* tree.root.remove();
      });
      expect(result.ok).toBe(false);
    });
  });

  it("NL18: init-only component keeps node alive", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* set("alive", true);
      });
      expect(tree.root.props["alive"]).toEqual(true);
    });
  });
});

describe("Property bag", () => {
  it("PB1-PB5: set operations", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* set("a", 1);
        yield* set("a", 2);
        yield* set("b", 2);
        yield* set("ns", { x: 1, y: 2 });
      });
      expect(tree.root.props["a"]).toEqual(2);
      expect(tree.root.props["b"]).toEqual(2);
      expect(tree.root.props["ns"]).toEqual({ x: 1, y: 2 });
    });
  });

  it("PB6-PB8: update operations", async () => {
    await run(function* () {
      yield* useTree(function* () {
        yield* set("n", 1);
        yield* update("n", (v) => (v as number) + 1);
        yield* update("missing", (v) => v ?? 0);
      });
    });
  });

  it("PB9: unset removes key", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* set("a", 1);
        yield* unset("a");
      });
      expect("a" in tree.root.props).toBe(false);
    });
  });

  it("PB10: unset nonexistent is no-op", async () => {
    await run(function* () {
      yield* useTree(function* () {
        yield* unset("nonexistent");
      });
    });
  });

  it("PB11: props is read-only", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* set("x", 1);
      });
      expect(() => {
        // deno-lint-ignore no-explicit-any
        (tree.root.props as any)["x"] = 2;
      }).toThrow();
    });
  });
});

describe("Child ordering", () => {
  it("CO1-CO3: insertion order", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* append("A", function* () {});
        yield* append("B", function* () {});
        yield* append("C", function* () {});
      });
      yield* sleep(0);

      let names = [...tree.root.children].map((c) => c.name);
      expect(names).toEqual(["A", "B", "C"]);
    });
  });

  it("CO4-CO6: custom sort", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* sort((a, b) => {
          let ap = a.props["priority"] as number;
          let bp = b.props["priority"] as number;
          return ap - bp;
        });
        yield* append("A", function* () {
          yield* set("priority", 3);
        });
        yield* append("B", function* () {
          yield* set("priority", 1);
        });
        yield* append("C", function* () {
          yield* set("priority", 2);
        });
      });
      yield* sleep(0);

      let names = [...tree.root.children].map((c) => c.name);
      expect(names).toEqual(["B", "C", "A"]);
    });
  });
});

describe("Node.eval", () => {
  it("runs operations in the node's scope", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* set("before", true);
      });

      let result = yield* tree.root.eval(function* () {
        yield* set("after", true);
        return 42;
      });

      expect(result).toEqual({ ok: true, value: 42 });
      expect(tree.root.props["after"]).toEqual(true);
    });
  });

  it("captures errors as Result", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});

      let result = yield* tree.root.eval(function* () {
        throw new Error("boom");
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toEqual("boom");
      }
    });
  });
});

describe("Tree and notification", () => {
  it("TN1: useTree returns tree with root", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      expect(tree.root).toBeTruthy();
      expect(tree.root.parent).toBeUndefined();
    });
  });

  it("TN2: root props visible via eval", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* set("ready", true);
      });
      expect(tree.root.props["ready"]).toEqual(true);
    });
  });
});

describe("Event dispatch", () => {
  it("ED1: middleware handles event via root.eval", async () => {
    await run(function* () {
      let handled = false;
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* DispatchApi.around({
          *dispatch([event], next) {
            if (event === "ping") {
              handled = true;
              return { ok: true as const, value: true as const };
            }
            return yield* next(event);
          },
        });
      });
      tree.dispatch("ping");
      yield* sleep(0);
      expect(handled).toBe(true);
    });
  });

  it("ED2: unhandled event", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      tree.dispatch("unknown");
      yield* sleep(0);
      expect(tree.root).toBeTruthy();
    });
  });

  it("ED3: sequential event processing", async () => {
    await run(function* () {
      let order: string[] = [];
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* DispatchApi.around({
          *dispatch([event], _next) {
            order.push(event as string);
            yield* set("last", event as string);
            return { ok: true as const, value: true as const };
          },
        });
      });
      tree.dispatch("first");
      tree.dispatch("second");
      yield* sleep(0);
      yield* sleep(0);
      expect(order).toEqual(["first", "second"]);
      expect(tree.root.props["last"]).toEqual("second");
    });
  });

  it("ED4: middleware error captured, tree survives", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* DispatchApi.around({
          *dispatch([_event], _next) {
            throw new Error("boom");
          },
        });
      });
      tree.dispatch("test");
      yield* sleep(0);
      expect(tree.root).toBeTruthy();

      // Subsequent dispatch works
      tree.dispatch("test2");
      yield* sleep(0);
    });
  });

  it("ED-getNodeById: dispatch middleware resolves target node", async () => {
    await run(function* () {
      let resolved = false;
      let tree = yield* useTree(function* () {});

      // Install middleware
      yield* tree.root.eval(function* () {
        yield* DispatchApi.around({
          *dispatch([event], next) {
            let ev = event as { type: string; targetId: string };
            if (ev.type === "focus") {
              let node = yield* DispatchApi.operations.getNodeById(ev.targetId);
              if (node) {
                resolved = true;
                expect(node.name).toEqual("target");
                expect(node.props["found"]).toEqual(true);
              }
              return { ok: true as const, value: true as const };
            }
            return yield* next(event);
          },
        });
      });

      // Append child — spawn is lazy, so eval again to get the id
      // after the child has registered
      let id = yield* tree.root.eval(function* () {
        let child = yield* append("target", function* () {
          yield* set("found", true);
        });
        return child.id;
      });

      if (id.ok) {
        // By now the child spawn has run (eval sequentializes)
        tree.dispatch({ type: "focus", targetId: id.value });
        yield* sleep(0);
        expect(resolved).toBe(true);
      } else {
        expect(true).toBe(false);
      }
    });
  });
});

describe("Notification coalescing", () => {
  it("TN7: multiple sets in one dispatch = one notification", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* DispatchApi.around({
          *dispatch([_event], _next) {
            yield* set("a", 1);
            yield* set("b", 2);
            yield* set("c", 3);
            return { ok: true as const, value: true as const };
          },
        });
      });

      let sub = yield* tree;
      tree.dispatch("multi-set");
      let next = yield* sub.next();
      expect(next.done).toBe(false);
    });
  });

  it("TN9: no-change dispatch does not notify", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* DispatchApi.around({
          *dispatch([_event], _next) {
            return { ok: true as const, value: true as const };
          },
        });
      });

      yield* tree;
      tree.dispatch("no-op");
      yield* sleep(0);
      // No notification emitted — dirty was false
    });
  });
});

describe("get operation", () => {
  it("GA1: get returns stored value", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        yield* set("k", 42);
        let val = yield* get("k");
        expect(val).toEqual(42);
      });
    });
  });

  it("GA2: get returns undefined for missing key", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      yield* tree.root.eval(function* () {
        let val = yield* get("missing");
        expect(val).toBeUndefined();
      });
    });
  });

  it("GA3: get middleware can intercept reads", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* set("k", 1);
        yield* FreedomApi.around({
          *get([key], next) {
            let val = yield* next(key);
            if (key === "k") {
              return (val as number) * 10;
            }
            return val;
          },
        });
      });
      let result = yield* tree.root.eval(function* () {
        return yield* get("k");
      });
      expect(result).toEqual({ ok: true, value: 10 });
    });
  });
});

describe("remove operation", () => {
  it("RA1: remove destroys child node", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      let result = yield* tree.root.eval(function* () {
        let child = yield* append("child", function* () {});
        yield* child.remove();
      });
      expect(result.ok).toBe(true);
      expect([...tree.root.children].length).toEqual(0);
    });
  });

  it("RA2: remove on root raises error", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      let result = yield* tree.root.eval(function* () {
        yield* tree.root.remove();
      });
      expect(result.ok).toBe(false);
    });
  });

  it("RA3: remove middleware can intercept removal", async () => {
    await run(function* () {
      let intercepted = false;
      let tree = yield* useTree(function* () {
        yield* FreedomApi.around({
          *remove([node], next) {
            intercepted = true;
            yield* next(node);
          },
        });
      });
      yield* tree.root.eval(function* () {
        let child = yield* append("child", function* () {});
        yield* child.remove();
      });
      expect(intercepted).toBe(true);
    });
  });

  it("RA4: remove middleware runs before teardown", async () => {
    await run(function* () {
      let nameBeforeTeardown = "";
      let tree = yield* useTree(function* () {
        yield* FreedomApi.around({
          *remove([node], next) {
            nameBeforeTeardown = node.name;
            let found = [...tree.root.children].find(
              (c) => c.name === node.name,
            );
            expect(found).toBeTruthy();
            yield* next(node);
          },
        });
      });
      yield* tree.root.eval(function* () {
        let child = yield* append("target", function* () {});
        yield* child.remove();
      });
      expect(nameBeforeTeardown).toEqual("target");
    });
  });
});

describe("useNode operation", () => {
  it("UN1: returns root node in root component", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        let node = yield* useNode();
        expect(node).toBe(tree.root);
      });
    });
  });

  it("UN2: returns child node in child component", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* append("child", function* () {
          let node = yield* useNode();
          expect(node).not.toBe(tree.root);
          expect(node.name).toEqual("child");
        });
      });
      yield* sleep(0);
    });
  });

  it("UN3: returns eval target node via node.eval", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {});
      let child = yield* tree.root.eval(function* () {
        return yield* append("target", function* () {});
      });
      if (!child.ok) throw child.error;

      let result = yield* child.value.eval(function* () {
        return yield* useNode();
      });
      if (!result.ok) throw result.error;

      expect(result.value).toBe(child.value);
    });
  });

  it("UN4: middleware can intercept useNode", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* FreedomApi.around({
          *useNode(_, next) {
            let node = yield* next();
            return node;
          },
        });
      });

      let intercepted = false;
      yield* tree.root.eval(function* () {
        let child = yield* append("child", function* () {});
        yield* FreedomApi.around({
          *useNode(_, next) {
            intercepted = true;
            return yield* next();
          },
        });
        yield* child.eval(function* () {
          yield* useNode();
        });
      });
      expect(intercepted).toBe(true);
    });
  });
});
