import {
  createSignal,
  type Operation,
  resource,
  spawn,
  suspend,
  withResolvers,
} from "effection";
import type { Component, Tree } from "./types.ts";
import { NodeContext, NodeImpl, spawnEvalLoop } from "./node.ts";
import { TreeContext, type TreeState } from "./state.ts";
import { DispatchApi } from "./dispatch.ts";
import { FreedomApi } from "./freedom.ts";

export function useTree(root: Component): Operation<Tree> {
  return resource<Tree>(function* (provide) {
    let output = createSignal<void, never>();
    let events = createSignal<unknown, void>();

    let counter = 0;
    let state: TreeState = {
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

    let rootNode = new NodeImpl(state.nextId(), "", undefined);
    rootNode.remove = () => FreedomApi.operations.remove(rootNode);
    state.nodes.set(rootNode.id, rootNode);

    let ready = withResolvers<void>();

    // Spawn root node scope
    yield* spawn(function* () {
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
          let node = yield* next(...args);
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

      yield* spawnEvalLoop(rootNode._channel);

      // Subscribe to events, then spawn the event loop
      let sub = yield* events;
      yield* spawn(function* () {
        while (true) {
          let next = yield* sub.next();
          if (next.done) {
            break;
          }
          let event = next.value;
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

    let tree: Tree = {
      dispatch(event: unknown) {
        events.send(event);
      },
      root: rootNode,
      [Symbol.iterator]: output[Symbol.iterator],
    };

    yield* provide(tree);
  });
}
