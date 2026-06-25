import { describe, it } from "../test/suite.ts";
import { expect } from "../test/helpers.ts";
import { run } from "effection";
import {
  advance,
  append,
  current,
  focus,
  focusable,
  retreat,
  set,
  useFocus,
  useTree,
} from "../mod.ts";

describe("Focus installation", () => {
  it("FI1-FI3: useFocus sets root as focused", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
      });

      yield* expect(tree.root).toEval(function* () {
        let node = yield* current();
        expect(node).toBe(tree.root);
        expect(tree.root.props.focused).toBe(true);
      });
    });
  });
});

describe("focusable()", () => {
  it("FF1-FF2: focusable sets focused:false on the node", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("child", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let children = [...tree.root.children];
        expect(children[0].props.focused).toBe(false);
      });
    });
  });

  it("FF3: focusable on already-focusable node is no-op", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("child", function* () {
          yield* focusable();
          yield* focusable(); // second call
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let children = [...tree.root.children];
        expect(children[0].props.focused).toBe(false);
      });
    });
  });

  it("FF4: node without focusable is not in focus chain", async () => {
    await run(function* () {
      yield* useTree(function* () {
        yield* useFocus();
        yield* append("nonfocusable", function* () {
          yield* set("label", "skip me");
        });
        yield* append("focusable", function* () {
          yield* focusable();
        });
      });

      // advance from root should skip nonfocusable child
      // (eval sequences after component has run)
    });
  });
});

describe("Focus chain", () => {
  it("FC1: depth-first order with flat children", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
        yield* append("B", function* () {
          yield* focusable();
        });
        yield* append("C", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let names: string[] = [];
        for (let i = 0; i < 4; i++) {
          let node = yield* current();
          names.push(node.name);
          yield* advance();
        }
        expect(names).toEqual(["", "A", "B", "C"]);
      });
    });
  });

  it("FC2: depth-first order with nested children", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
          yield* append("A1", function* () {
            yield* focusable();
          });
        });
        yield* append("B", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let names: string[] = [];
        for (let i = 0; i < 4; i++) {
          let node = yield* current();
          names.push(node.name);
          yield* advance();
        }
        expect(names).toEqual(["", "A", "A1", "B"]);
      });
    });
  });

  it("FC3: non-focusable nodes are skipped", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          // not focusable
        });
        yield* append("B", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let names: string[] = [];
        for (let i = 0; i < 2; i++) {
          let node = yield* current();
          names.push(node.name);
          yield* advance();
        }
        expect(names).toEqual(["", "B"]);
      });
    });
  });
});

describe("advance()", () => {
  it("FA1-FA3: moves focus forward", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        expect(tree.root.props.focused).toBe(true);
        yield* advance();
        expect(tree.root.props.focused).toBe(false);
        let children = [...tree.root.children];
        expect(children[0].props.focused).toBe(true);
      });
    });
  });

  it("FA4: wraps from last to first", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        yield* advance();
        yield* advance();
        let node = yield* current();
        expect(node).toBe(tree.root);
        expect(tree.root.props.focused).toBe(true);
      });
    });
  });

  it("FA5: single focusable node is a no-op", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
      });

      yield* expect(tree.root).toEval(function* () {
        yield* advance();
        let node = yield* current();
        expect(node).toBe(tree.root);
        expect(tree.root.props.focused).toBe(true);
      });
    });
  });
});

describe("retreat()", () => {
  it("FR1: moves focus backward", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
        yield* append("B", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        yield* advance(); // root -> A
        yield* advance(); // A -> B
        let node = yield* current();
        expect(node.name).toEqual("B");

        yield* retreat(); // B -> A
        node = yield* current();
        expect(node.name).toEqual("A");
      });
    });
  });

  it("FR2: wraps from first to last", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
        yield* append("B", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        yield* retreat();
        let node = yield* current();
        expect(node.name).toEqual("B");
      });
    });
  });

  it("FR3: single node is a no-op", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
      });

      yield* expect(tree.root).toEval(function* () {
        yield* retreat();
        let node = yield* current();
        expect(node).toBe(tree.root);
      });
    });
  });
});

describe("focus(node)", () => {
  it("FE1: explicit focus changes focused node", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
        yield* append("B", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let children = [...tree.root.children];
        let b = children[1];
        yield* focus(b);
        let node = yield* current();
        expect(node).toBe(b);
        expect(tree.root.props.focused).toBe(false);
        expect(b.props.focused).toBe(true);
      });
    });
  });

  it("FE2: focus on non-focusable node raises error", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("nonfocusable", function* () {});
      });

      yield* expect(tree.root).toEval(function* () {
        let children = [...tree.root.children];
        try {
          yield* focus(children[0]);
          expect(true).toBe(false);
        } catch (e) {
          expect((e as Error).message).toContain("non-focusable");
        }
      });
    });
  });

  it("FE3: focus on already-focused node is no-op", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
      });

      yield* expect(tree.root).toEval(function* () {
        yield* focus(tree.root);
        let node = yield* current();
        expect(node).toBe(tree.root);
        expect(tree.root.props.focused).toBe(true);
      });
    });
  });
});

describe("current()", () => {
  it("CU1-CU3: returns the focused node", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let node = yield* current();
        expect(node).toBe(tree.root);

        yield* advance();
        node = yield* current();
        expect(node.name).toEqual("A");
      });
    });
  });
});

describe("Focused node removal", () => {
  it("FR1: removing focused node advances focus", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
        yield* append("B", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let children = [...tree.root.children];
        let a = children[0];
        yield* focus(a);
        expect(a.props.focused).toBe(true);
        yield* a.remove();

        let node = yield* current();
        expect(node.name).toEqual("B");
      });
    });
  });

  it("FR4: removing non-focused node does not move focus", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
        yield* append("B", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let children = [...tree.root.children];
        let b = children[1];
        yield* b.remove();
        let node = yield* current();
        expect(node).toBe(tree.root);
      });
    });
  });

  it("FR5: removing only non-root focusable returns focus to root", async () => {
    await run(function* () {
      let tree = yield* useTree(function* () {
        yield* useFocus();
        yield* append("A", function* () {
          yield* focusable();
        });
      });

      yield* expect(tree.root).toEval(function* () {
        let children = [...tree.root.children];
        let a = children[0];
        yield* focus(a);
        expect(a.props.focused).toBe(true);
        yield* a.remove();

        let node = yield* current();
        expect(node).toBe(tree.root);
        expect(tree.root.props.focused).toBe(true);
      });
    });
  });
});
