import type { Node } from "@bomb.sh/freedom";
import { deleteForward, KeyboardApi, moveBack, moveForward, moveMax, moveMin } from "./input.ts";

export function useReadlineKeymap({ scope }: Node): void {
  scope.around(KeyboardApi, {
    keydown([node, event], next) {
      if (node.get("input") && event.ctrl) {
        let { code } = event;
        if (code === "a") {
          moveMin(node);
        } else if (code === "e") {
          moveMax(node);
        } else if (code === "f") {
          moveForward(node);
        } else if (code === "b") {
          moveBack(node);
        } else if (code === "d") {
          deleteForward(node);
        } else {
          next(node, event);
        }
      } else {
        next(node, event);
      }
    }
  })
}
