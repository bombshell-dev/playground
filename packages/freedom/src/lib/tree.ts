import {
  createSignal,
  type Operation,
  resource,
  spawn,
  suspend,
  useScope,
  withResolvers,
} from "effection";
import type { Component, Tree } from "./types.ts";
import { NodeContext, NodeImpl } from "./node.ts";
import { TreeContext, type TreeState } from "./state.ts";
import { DispatchApi } from "./dispatch.ts";
import { FreedomApi } from "./freedom.ts";

export function useTree(root: Component): Operation<Tree> {
  return resource<Tree>(function* (provide) {
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

    yield* TreeContext.set(state);

    const rootNode = new NodeImpl(state.nextId(), "", undefined);
    rootNode.remove = () => FreedomApi.operations.remove(rootNode);
    state.nodes.set(rootNode.id, rootNode);

    const ready = withResolvers<void>();

    // Spawn root node scope
    yield* spawn(function* () {
      rootNode.scope = yield* useScope();
      yield* NodeContext.set(rootNode);

      // Mark dirty after every mutation
      yield* FreedomApi.around({
        *set(args, next) {
          yield* next(...args);
          state.markDirty();
        },
        *update(args, next) {
          yield* next(...args);
          state.markDirty();
        },
        *unset(args, next) {
          yield* next(...args);
          state.markDirty();
        },
        *append(args, next) {
          const node = yield* next(...args);
          state.markDirty();
          return node;
        },
        *remove(args, next) {
          yield* next(...args);
          state.markDirty();
        },
        *sort(args, next) {
          yield* next(...args);
          state.markDirty();
        },
      });

      // Subscribe to events, then spawn the event loop
      const sub = yield* events;
      yield* spawn(function* () {
        while (true) {
          const next = yield* sub.next();
          if (next.done) {
            break;
          }
          const event = next.value;
          state.dirty = false;
          yield* rootNode.eval(() => DispatchApi.operations.dispatch(event));
          if (state.dirty) {
            output.send();
          }
        }
      });

      ready.resolve();

      yield* root();
      yield* suspend();
    });

    yield* ready.operation;

    const tree: Tree = {
      dispatch(event: unknown) {
        events.send(event);
      },
      root: rootNode,
      [Symbol.iterator]: output[Symbol.iterator],
    };

    yield* provide(tree);
  });
}
