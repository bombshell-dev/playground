import { createSignal } from "effection";
import type { Root } from "./types.ts";
import { NodeImpl } from "./node.ts";
import { TreeContext, type TreeState } from "./state.ts";
import { DispatchApi } from "./dispatch.ts";

export function createRoot(): Root {
  const output = createSignal<void, never>();
  const events = createSignal<unknown, void>();

  let counter = 0;
  const state: TreeState = {
    dirty: false,
    output,
    events,
    nodes: new Map(),
    nextId() {
      return `node-${++counter}`;
    },
    markDirty() {
      state.dirty = true;
    },
  };

  const node = new NodeImpl(state.nextId(), "", undefined);
  node.scope.set(TreeContext, state);
  state.nodes.set(node.id, node);

  // Dispatch loop: drain events through the demux middleware chain.
  node.scope.run(function* () {
    const sub = yield* events;
    while (true) {
      const next = yield* sub.next();
      if (next.done) {
        break;
      }
      state.dirty = false;
      yield* DispatchApi.operations.dispatch(next.value);
      if (state.dirty) {
        output.send();
      }
    }
  });

  return {
    node,
    dispatch(event) {
      events.send(event);
    },
    [Symbol.iterator]: output[Symbol.iterator],
    destroy() {
      return node.destroy();
    },
  };
}
