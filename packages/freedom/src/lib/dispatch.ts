// oxlint-disable require-yield
import type { Api, Operation, Result } from "effection";
import { createApi } from "effection/experimental";
import type { Node } from "./types.ts";
import { TreeContext } from "./state.ts";

export interface Dispatch {
  dispatch(event: unknown): Operation<Result<true>>;
  getNodeById(id: string): Operation<Node | undefined>;
}

type Method<T, TArgs extends unknown[]> = (...args: TArgs) => Operation<T>;

export class DispatchEvent<T = unknown, TArgs extends unknown[] = unknown[]> {
  target: Node;
  method: Method<T, TArgs>;
  args: TArgs;
  callback?: (result: Result<T>) => Operation<void>;

  constructor(options: {
    target: Node;
    method: Method<T, TArgs>;
    args: TArgs;
    callback?: (result: Result<T>) => Operation<void>;
  }) {
    this.target = options.target;
    this.method = options.method;
    this.args = options.args;
    this.callback = options.callback;
  }
}

// Enqueue an eval-event to run `event.method(...args)` in `target`'s scope on a
// later, idle cycle. Always requires a target.
export function* dispatch<T, TArgs extends unknown[]>(
  target: Node,
  event: {
    method: Method<T, TArgs>;
    args: TArgs;
    callback?: (result: Result<T>) => Operation<void>;
  },
): Operation<void> {
  const tree = yield* TreeContext.expect();
  tree.dispatch(new DispatchEvent({ ...event, target }));
}

export const DispatchApi: Api<Dispatch> = createApi<Dispatch>(
  "freedom:dispatch",
  {
    *dispatch(_event: unknown): Operation<Result<true>> {
      return { ok: false, error: new Error("unhandled") };
    },

    *getNodeById(id: string): Operation<Node | undefined> {
      const tree = yield* TreeContext.expect();
      return tree.nodes.get(id);
    },
  },
);

// Bundled core extension: handle DispatchEvent on the dispatch chain.
// Installed by useTree.
export function useDispatch(): Operation<void> {
  return DispatchApi.around({
    *dispatch([event], next) {
      if (event instanceof DispatchEvent) {
        const result = yield* event.target.eval(() => event.method(...event.args));
        if (event.callback) {
          yield* event.callback(result);
        }
        return result.ok ? { ok: true, value: true } : result;
      }
      return yield* next(event);
    },
  });
}
