import {
  type Api,
  type Operation,
  spawn,
  suspend,
  withResolvers,
} from "effection";
import { createApi } from "effection/experimental";
import {
  type Component,
  createNodeData,
  type JsonValue,
  type Node,
} from "./types.ts";
import { NodeContext, NodeImpl, spawnEvalLoop } from "./node.ts";
import { TreeContext } from "./state.ts";
import { validateJsonValue } from "./validate.ts";

const Halt = createNodeData<() => Operation<void>>(
  "freedom:halt",
  function* () {
    throw new Error("Cannot remove root node");
  },
);

export interface Freedom {
  useNode(): Operation<Node>;
  get(key: string): Operation<JsonValue | undefined>;
  set(key: string, value: JsonValue): Operation<void>;
  update(
    key: string,
    fn: (prev: JsonValue | undefined) => JsonValue,
  ): Operation<void>;
  unset(key: string): Operation<void>;
  append(name: string, component: Component): Operation<Node>;
  remove(node: Node): Operation<void>;
  sort(fn: ((a: Node, b: Node) => number) | undefined): Operation<void>;
}

export const FreedomApi: Api<Freedom> = createApi<Freedom>("freedom:node", {
  useNode: () => NodeContext.expect(),

  *get(key: string): Operation<JsonValue | undefined> {
    let node = yield* NodeContext.expect();
    return node._props[key];
  },

  *set(key: string, value: JsonValue) {
    validateJsonValue(value);
    let node = yield* NodeContext.expect();
    node._props[key] = value;
  },

  *update(key: string, fn: (prev: JsonValue | undefined) => JsonValue) {
    let node = yield* NodeContext.expect();
    let prev = node._props[key];
    let next = fn(prev);
    validateJsonValue(next);
    node._props[key] = next;
  },

  *unset(key: string) {
    let node = yield* NodeContext.expect();
    if (key in node._props) {
      delete node._props[key];
    }
  },

  *append(name: string, component: Component): Operation<Node> {
    let parent = yield* NodeContext.expect();
    let tree = yield* TreeContext.expect();
    let child = new NodeImpl(tree.nextId(), name, parent);
    let ready = withResolvers<void>();

    let task = yield* spawn(function* () {
      parent._children.add(child);
      tree.nodes.set(child.id, child);
      yield* NodeContext.set(child);
      yield* spawnEvalLoop(child._channel);
      ready.resolve();
      try {
        yield* component();
        yield* suspend();
      } finally {
        parent._children.delete(child);
        tree.nodes.delete(child.id);
        tree.markDirty();
      }
    });
    child.data.set(Halt, task.halt);
    child.remove = () => FreedomApi.operations.remove(child);

    yield* ready.operation;
    return child;
  },

  *remove(node: Node) {
    let halt = node.data.expect(Halt);
    yield* halt();
  },

  *sort(fn: ((a: Node, b: Node) => number) | undefined) {
    let node = yield* NodeContext.expect();
    node._sortFn = fn;
  },
});

export const useNode: typeof FreedomApi.operations.useNode =
  FreedomApi.operations.useNode;
export const get: typeof FreedomApi.operations.get = FreedomApi.operations.get;
export const set: typeof FreedomApi.operations.set = FreedomApi.operations.set;
export const update: typeof FreedomApi.operations.update =
  FreedomApi.operations.update;
export const unset: typeof FreedomApi.operations.unset =
  FreedomApi.operations.unset;
export const append: typeof FreedomApi.operations.append =
  FreedomApi.operations.append;
export const remove: typeof FreedomApi.operations.remove =
  FreedomApi.operations.remove;
export const sort: typeof FreedomApi.operations.sort =
  FreedomApi.operations.sort;
