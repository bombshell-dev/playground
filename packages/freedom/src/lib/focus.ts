import type { Api, Operation } from "effection";
import { createApi } from "effection/experimental";
import type { Node } from "./types.ts";
import { FreedomApi, set } from "./freedom.ts";
import { NodeContext, type NodeImpl } from "./node.ts";

export interface Focus {
  focusable(): Operation<void>;
  advance(): Operation<void>;
  retreat(): Operation<void>;
  focus(node: Node): Operation<void>;
  current(): Operation<Node>;
}

function findRoot(node: Node): Node {
  let n = node;
  while (n.parent) {
    n = n.parent;
  }
  return n;
}

function focusChain(node: Node): Node[] {
  let result: Node[] = [];
  if ("focused" in node.props) {
    result.push(node);
  }
  for (let child of node.children) {
    result.push(...focusChain(child));
  }
  return result;
}

function* setFocused(
  target: Node,
  value: boolean,
  self: NodeImpl,
): Operation<void> {
  if (target === self) {
    yield* set("focused", value);
  } else {
    yield* target.eval(() => set("focused", value));
  }
}

export const FocusApi: Api<Focus> = createApi<Focus>("freedom:focus", {
  *focusable() {
    let node = yield* NodeContext.expect();
    if (!("focused" in node.props)) {
      yield* set("focused", false);
    }
  },

  *advance() {
    let self = yield* NodeContext.expect();
    let r = findRoot(self);
    let nodes = focusChain(r);
    if (nodes.length <= 1) return;

    let idx = nodes.findIndex((n) => n.props.focused === true);
    if (idx === -1) return;

    let old = nodes[idx];
    let next = nodes[(idx + 1) % nodes.length];

    yield* setFocused(old, false, self);
    yield* setFocused(next, true, self);
  },

  *retreat() {
    let self = yield* NodeContext.expect();
    let r = findRoot(self);
    let nodes = focusChain(r);
    if (nodes.length <= 1) return;

    let idx = nodes.findIndex((n) => n.props.focused === true);
    if (idx === -1) return;

    let old = nodes[idx];
    let prev = nodes[(idx - 1 + nodes.length) % nodes.length];

    yield* setFocused(old, false, self);
    yield* setFocused(prev, true, self);
  },

  *focus(target: Node) {
    if (!("focused" in target.props)) {
      throw new Error("Cannot focus a non-focusable node");
    }
    if (target.props.focused === true) return;

    let self = yield* NodeContext.expect();
    let r = findRoot(target);
    let nodes = focusChain(r);
    let old = nodes.find((n) => n.props.focused === true);

    if (old) {
      yield* setFocused(old, false, self);
    }
    yield* setFocused(target, true, self);
  },

  *current() {
    let node = yield* NodeContext.expect();
    let r = findRoot(node);
    let nodes = focusChain(r);
    let focused = nodes.find((n) => n.props.focused === true);
    if (focused) {
      return focused;
    } else {
      return r;
    }
  },
});

export const focusable: typeof FocusApi.operations.focusable =
  FocusApi.operations.focusable;
export const advance: typeof FocusApi.operations.advance =
  FocusApi.operations.advance;
export const retreat: typeof FocusApi.operations.retreat =
  FocusApi.operations.retreat;
export const focus: typeof FocusApi.operations.focus =
  FocusApi.operations.focus;
export const current: typeof FocusApi.operations.current =
  FocusApi.operations.current;

export function* useFocus(): Operation<void> {
  yield* set("focused", true);

  yield* FreedomApi.around({
    *remove([node], next) {
      if (node.props.focused === true) {
        yield* FocusApi.operations.advance();
      }
      yield* next(node);
    },
  });
}
