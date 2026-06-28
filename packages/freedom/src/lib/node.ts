// oxlint-disable bombshell-dev/no-generic-error
// oxlint-disable max-params
import {
  type Context,
  createContext,
  createScope,
  Err,
  Ok,
  type Operation,
  type Result,
  type Scope,
} from "effection";
import type { JsonValue, Node, NodeData, NodeDataKey } from "./types.ts";
import { TreeContext } from "./state.ts";
import { validateJsonValue } from "./validate.ts";

class NodeDataImpl implements NodeData {
  _map: Map<symbol, unknown> = new Map();

  get<T>(key: NodeDataKey<T>): T | undefined {
    return this._map.get(key.symbol) as T | undefined;
  }

  set<T>(key: NodeDataKey<T>, value: T): void {
    this._map.set(key.symbol, value);
  }

  expect<T>(key: NodeDataKey<T>): T {
    const val = this._map.get(key.symbol);
    if (val !== undefined) {
      return val as T;
    } else if (key.defaultValue !== undefined) {
      return key.defaultValue;
    } else {
      throw new Error(`NodeData '${key.symbol.description}' not found`);
    }
  }
}

export class NodeImpl implements Node {
  _props: Record<string, JsonValue> = {};
  _children: Set<NodeImpl> = new Set();
  _sortFn: ((a: Node, b: Node) => number) | undefined = undefined;
  data: NodeData = new NodeDataImpl();
  scope: Scope;
  #dispose: () => Promise<void>;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly _parent: NodeImpl | undefined,
  ) {
    const [scope, dispose] = createScope(_parent?.scope);
    this.scope = scope;
    this.#dispose = dispose;
    scope.set(NodeContext, this);
  }

  get props(): Record<string, JsonValue> {
    return Object.freeze({ ...this._props });
  }

  get children(): Iterable<Node> {
    if (this._sortFn) {
      const fn = this._sortFn;
      const indexed = [...this._children].map((c, i) => [c, i] as const);
      indexed.sort(([a, ai], [b, bi]) => {
        const result = fn(a, b);
        if (result !== 0) {
          return result;
        } else {
          return ai - bi;
        }
      });
      return indexed.map(([c]) => c);
    } else {
      return this._children;
    }
  }

  get parent(): Node | undefined {
    return this._parent;
  }

  *eval<T>(op: () => Operation<T>): Operation<Result<T>> {
    // Run `op` inline with the current routine's scope temporarily repointed at
    // this node's scope, so the op sees this node's contexts/middleware.
    const restore = (yield {
      description: "freedom: enter node scope",
      enter: (
        resolve: (result: Result<() => void>) => void,
        routine: { scope: Scope },
      ) => {
        const original = routine.scope;
        routine.scope = this.scope;
        resolve(Ok(() => {
          routine.scope = original;
        }));
        return (resolveExit: (result: Result<void>) => void) =>
          resolveExit(Ok());
      },
    }) as () => void;
    try {
      return Ok(yield* op());
    } catch (error) {
      return Err(error as Error);
    } finally {
      restore();
    }
  }

  get(key: string): JsonValue | undefined {
    return this._props[key];
  }

  set(key: string, value: JsonValue): void {
    validateJsonValue(value);
    this._props[key] = value;
    this.scope.expect(TreeContext).markDirty();
  }

  update(key: string, fn: (prev: JsonValue | undefined) => JsonValue): void {
    const value = fn(this._props[key]);
    validateJsonValue(value);
    this._props[key] = value;
    this.scope.expect(TreeContext).markDirty();
  }

  unset(key: string): void {
    if (key in this._props) {
      delete this._props[key];
      this.scope.expect(TreeContext).markDirty();
    }
  }

  createChild(name = ""): Node {
    const state = this.scope.expect(TreeContext);
    const child = new NodeImpl(state.nextId(), name, this);
    this._children.add(child);
    state.nodes.set(child.id, child);
    state.markDirty();
    return child;
  }

  sort(fn?: (a: Node, b: Node) => number): void {
    this._sortFn = fn;
    this.scope.expect(TreeContext).markDirty();
  }

  destroy(): Promise<void> {
    return this.#dispose();
  }

  remove(): Operation<void> {
    throw new Error("Cannot remove root node");
  }
}

export const NodeContext: Context<NodeImpl> = createContext<NodeImpl>(
  "freedom:current-node",
);
