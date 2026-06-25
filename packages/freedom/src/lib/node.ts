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
    let val = this._map.get(key.symbol);
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
      let fn = this._sortFn;
      let indexed = [...this._children].map((c, i) => [c, i] as const);
      indexed.sort(([a, ai], [b, bi]) => {
        let result = fn(a, b);
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
    let resolver = withResolvers<Result<T>>();
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

export function* spawnEvalLoop(
  channel: Channel<CallEval, never>,
): Operation<void> {
  let ready = withResolvers<void>();

  yield* spawn(function* () {
    let sub = yield* channel as Stream<CallEval, never>;
    ready.resolve();

    while (true) {
      let next = yield* sub.next();
      if (next.done) {
        break;
      }
      let call = next.value;
      let result = yield* box(call.operation);
      call.resolve(result);
    }
  });

  yield* ready.operation;
}

export const NodeContext: Context<NodeImpl> = createContext<NodeImpl>(
  "freedom:current-node",
);
