// oxlint-disable bombshell-dev/no-generic-error
// oxlint-disable max-params
import {
  type Context,
  createContext,
  createScope,
  type Scope,
} from "effection";
import { createApi } from "effection/experimental";
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

  get(key: string): JsonValue | undefined {
    return NodeApi.invoke(this.scope, "get", [this, key]);
  }

  set(key: string, value: JsonValue): void {
    NodeApi.invoke(this.scope, "set", [this, key, value]);
  }

  update(key: string, fn: (prev: JsonValue | undefined) => JsonValue): void {
    NodeApi.invoke(this.scope, "update", [this, key, fn]);
  }

  unset(key: string): void {
    NodeApi.invoke(this.scope, "unset", [this, key]);
  }

  createChild(name = ""): Node {
    return NodeApi.invoke(this.scope, "createChild", [this, name]);
  }

  sort(fn?: (a: Node, b: Node) => number): void {
    NodeApi.invoke(this.scope, "sort", [this, fn]);
  }

  destroy(): Promise<void> {
    return this.#dispose();
  }

  remove(): Promise<void> {
    return NodeApi.invoke(this.scope, "remove", [this]);
  }
}

// Synchronous node mutation API. Core methods take the node first; interceptors
// are installed per scope via `node.scope.around(NodeApi, ...)`.
export const NodeApi = createApi("freedom:node", {
  get(node: NodeImpl, key: string): JsonValue | undefined {
    return node._props[key];
  },
  set(node: NodeImpl, key: string, value: JsonValue): void {
    validateJsonValue(value);
    node._props[key] = value;
    node.scope.expect(TreeContext).markDirty();
  },
  update(
    node: NodeImpl,
    key: string,
    fn: (prev: JsonValue | undefined) => JsonValue,
  ): void {
    const value = fn(node._props[key]);
    validateJsonValue(value);
    node._props[key] = value;
    node.scope.expect(TreeContext).markDirty();
  },
  unset(node: NodeImpl, key: string): void {
    if (key in node._props) {
      delete node._props[key];
      node.scope.expect(TreeContext).markDirty();
    }
  },
  createChild(node: NodeImpl, name: string): Node {
    const state = node.scope.expect(TreeContext);
    const child = new NodeImpl(state.nextId(), name, node);
    node._children.add(child);
    state.nodes.set(child.id, child);
    state.markDirty();
    return child;
  },
  sort(node: NodeImpl, fn: ((a: Node, b: Node) => number) | undefined): void {
    node._sortFn = fn;
    node.scope.expect(TreeContext).markDirty();
  },
  remove(node: NodeImpl): Promise<void> {
    if (!node._parent) {
      throw new Error("Cannot remove root node");
    }
    const state = node.scope.expect(TreeContext);
    node._parent._children.delete(node);
    state.nodes.delete(node.id);
    state.markDirty();
    return node.destroy();
  },
});

export const NodeContext: Context<NodeImpl> = createContext<NodeImpl>(
  "freedom:current-node",
);
