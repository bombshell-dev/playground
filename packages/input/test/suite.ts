import { createRoot, type Root } from "@bomb.sh/freedom";
import { useInput } from "../src/lib/input.ts";
import type { KeyCode } from "@bomb.sh/tty";
export { afterEach, beforeEach, describe, expect, it } from "vitest";

export interface TestInterface extends Root {
  type(str: string): void;
  keydown(code: KeyCode): void;
}

export function createTestInterface(): TestInterface {
  const root = createRoot() as TestInterface;
  useInput(root);
  root.type = (str) => {
    for (let char of [...str]) {
      root.dispatch({
        type: "keydown",
        key: char,
        code: char,
        text: char,
      })
    }
  };
  root.keydown = (code) => {
    root.dispatch({
      type: "keydown",
      key: code,
      code,
    });
  };
  return root;
}
