// oxlint-disable bombshell-dev/no-generic-error
// oxlint-disable max-params
import {
  type Channel,
  type Context,
  createChannel,
  createContext,
  Err,
  Ok,
  type Operation,
  type Result,
  spawn,
  type Stream,
  withResolvers,
} from "effection";
import type { JsonValue, Node, NodeData, NodeDataKey } from "./types.ts";

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

interface CallEval {
  operation: () => Operation<unknown>;
  resolve: (result: Result<unknown>) => void;
}

function box<T>(op: () => Operation<T>): Operation<Result<T>> {
  return {
    *[Symbol.iterator]() {
      try {
        return Ok(yield* op());
      } catch (error) {
        return Err(error as Error);
      }
    },
  };
}

export class NodeImpl implements Node {
  _props: Record<string, JsonValue> = {};
  _children: Set<NodeImpl> = new Set();
  _sortFn: ((a: Node, b: Node) => number) | undefined = undefined;
  _channel: Channel<CallEval, never> = createChannel<CallEval, never>();
  data: NodeData = new NodeDataImpl();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly _parent: NodeImpl | undefined,
  ) {}

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
    // Re-entrant call from inside this node's own eval loop: running through
    // the channel would deadlock (the loop is busy awaiting us), so run inline.
    const owner = yield* EvalOwner.get();
    if (owner === this) {
      return yield* box(op);
    }
    const resolver = withResolvers<Result<T>>();
    yield* this._channel.send({
      resolve: resolver.resolve as (result: Result<unknown>) => void,
      operation: op as () => Operation<unknown>,
    });
    return yield* resolver.operation;
  }

  remove(): Operation<void> {
    throw new Error("Cannot remove root node");
  }
}

export function* spawnEvalLoop(node: NodeImpl): Operation<void> {
  const ready = withResolvers<void>();

  yield* spawn(function* () {
    const sub = yield* node._channel as Stream<CallEval, never>;
    // Mark this task's scope as the owner of node's eval loop, so a re-entrant
    // node.eval() running within it short-circuits inline instead of deadlocking.
    yield* EvalOwner.set(node);
    ready.resolve();

    while (true) {
      const next = yield* sub.next();
      if (next.done) {
        break;
      }
      const call = next.value;
      const result = yield* box(call.operation);
      call.resolve(result);
    }
  });

  yield* ready.operation;
}

export const NodeContext: Context<NodeImpl> = createContext<NodeImpl>(
  "freedom:current-node",
);

// Set within a node's eval loop to identify re-entrant self-eval calls.
const EvalOwner: Context<NodeImpl> = createContext<NodeImpl>(
  "freedom:eval-owner",
);
