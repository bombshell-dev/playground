import { createApi } from "effection/experimental";
import { DispatchApi, focusable, current, type Node, type Root } from "@bomb.sh/freedom";
import type { KeyDown, KeyEvent, KeyRepeat, KeyUp } from "@bomb.sh/tty";

export const Input = createApi("@bomb.sh/input", {
  insert(node: Node, text: string): void {
    const codepoints = [...node.get("value") as string];
    const caret = node.get("caret") as number;
    codepoints.splice(caret, 0, text);
    node.set("value", codepoints.join(""));
    node.set("caret", caret + 1);
  },
  deleteBackward(node: Node): void {
    const codepoints = [...node.get("value") as string];
    let caret = node.get("caret") as number;
    const length = codepoints.length;
    if (caret > length) {
      console.warn("caret mismatch: ${caret}, value length: ${length}");
      caret = length;
    }
    if (caret > 0) {
      codepoints.splice(caret - 1, 1);
      node.set("value", codepoints.join(""));
      node.set("caret", caret - 1);
    }
  },
  deleteForward(node: Node): void {
    const codepoints = [...node.get("value") as string];
    let caret = node.get("caret") as number;
    const length = codepoints.length;
    if (caret > length) {
      console.warn("caret mismatch: ${caret}, value length: ${length}");
      caret = length;
    }
    if (caret < length) {
      codepoints.splice(caret, 1);
      node.set("value", codepoints.join(""));
    }
  },
  moveBack(node: Node): void {
    const caret = node.get("caret") as number;
    node.set("caret", Math.max(0, caret - 1));
  },
  moveForward(node: Node): void {
    const caret = node.get("caret") as number;
    const codepoints = [...node.get("value") as string];
    node.set("caret", Math.min(codepoints.length, caret + 1));
  },  
  moveMin(node: Node): void {
    node.set("caret", 0);
  },
  moveMax(node: Node): void {
    node.set("caret", [...node.get("value") as string].length);    
  },
  keydown(node: Node, event: KeyDown): void {
    if (node.get("input")) {
      if (event.text && event.text?.length > 0) {
        Input.invoke(node.scope, "insert", [node, event.text]);
      } else if (event.code === "Backspace") {
        Input.invoke(node.scope, "deleteBackward", [node]);
      } else if (event.code === "Delete") {
        Input.invoke(node.scope, "deleteForward", [node]);
      } else if (event.code === "ArrowLeft") {
        Input.invoke(node.scope, "moveBack", [node]);
      } else if (event.code === "ArrowRight") {
        Input.invoke(node.scope, "moveForward", [node]);
      } else if (event.code === "Home") {
        Input.invoke(node.scope, "moveMin", [node]);
      } else if (event.code === "End") {
        Input.invoke(node.scope, "moveMax", [node]);
      }
    }
  },
  keyup(_node: Node, _event: KeyUp): void { },
  keyrepeat(_node: Node, _event: KeyRepeat): void { },
})

// Install a text input onto a node. This stub seeds only the DOM-shaped state
// (`value`, `selectionStart`, `selectionEnd`, `selectionDirection`) and makes
// the node focusable. Editing behavior is enumerated as skipped specs under
// `test/` and is not yet implemented — the interaction API is intentionally
// left unprescribed until the state model is settled.
export function makeInput(node: Node): void {
  focusable(node);
  node.set("input", true);
  node.set("value", "");
  node.set("caret", 0);
}

export function useInput(root: Root): void {
  root.node.scope.around(DispatchApi, {
    *dispatch([event], next) {
      if (isKeyEvent(event)) {
        let target = current(root.node);
        Input.invoke(target.scope, event.type, [target, event as KeyDown & KeyUp & KeyRepeat]);
        return { ok: true, value: true };
      }
      return yield* next(event);
    }
  });
}

function isKeyEvent(event: unknown): event is KeyEvent {
  const x = event as KeyEvent;
  //  console.log({ x, key: typeof x.key === "string", code: typeof x.code === "string", type: ["keyup", "keydown", "keyrepeat"].includes(x.type) });
  return !!x && typeof x.key === "string" && typeof x.code === "string" &&
    ["keyup", "keydown", "keyrepeat"].includes(x.type);
}
