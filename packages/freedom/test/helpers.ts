import { expect as viExpect } from "vitest";
import { type Operation, sleep } from "effection";
import type { Node } from "../src/index.ts";

type Assertion = ReturnType<typeof viExpect>;
type NodeExpected = Assertion & {
  toEval(fn: () => Operation<void>): Operation<void>;
};

export function expect(value: Node): NodeExpected;
export function expect<T>(value: T): Assertion;
export function expect(value: unknown): NodeExpected | Assertion {
  let base = viExpect(value);
  if (value && typeof value === "object" && "eval" in value) {
    let node = value as Node;
    return new Proxy(base as unknown as NodeExpected, {
      get(target, prop, receiver) {
        if (prop === "toEval") {
          return (fn: () => Operation<void>): Operation<void> => ({
            *[Symbol.iterator]() {
              // let pending child component tasks settle
              yield* sleep(0);
              let r = yield* node.eval(fn);
              if (!r.ok) {
                throw r.error;
              }
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }
  return base;
}
