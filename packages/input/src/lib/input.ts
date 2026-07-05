import { createApi } from "effection/experimental";
import { DispatchApi, focusable, current, type Node, type Root } from "@bomb.sh/freedom";
import type { KeyDown, KeyEvent, KeyRepeat, KeyUp } from "@bomb.sh/tty";

export const KeyboardApi = createApi("@bomb.sh/keyboard", {
  keydown(node: Node, event: KeyDown): void {
    if (node.get("input")) {
      if (event.text && event.text?.length > 0) {
        insert(node, event.text);
      } else if (event.code === "Backspace") {
        deleteBackward(node);
      } else if (event.code === "Delete") {
        deleteForward(node);
      } else if (event.code === "ArrowLeft") {
        moveBack(node);
      } else if (event.code === "ArrowRight") {
        moveForward(node);
      } else if (event.code === "Home") {
        moveMin(node);
      } else if (event.code === "End") {
        moveMax(node);
      }
    }
  },
  keyup(_node: Node, _event: KeyUp): void { },
  keyrepeat(node: Node, event: KeyRepeat): void {
    KeyboardApi.invoke(node.scope, "keydown", [node, {
      ...event,
      type: "keydown",
    }]);
  },
})

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
})

// Install a text input onto a node. This stub seeds only the DOM-shaped state
// (`value`, `selectionStart`, `selectionEnd`, `selectionDirection`) and makes
// the node focusable. Editing behavior is enumerated as skipped specs under
// `test/` and is not yet implemented — the interaction API is intentionally
// left unprescribed until the state model is settled.
export function initInput(node: Node): void {
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
        KeyboardApi.invoke(target.scope, event.type, [target, event as KeyDown & KeyUp & KeyRepeat]);
        return { ok: true, value: true };
      }
      return yield* next(event);
    }
  });

  root.node.scope.around(KeyboardApi, {
    keydown([node, event], next): void {
      if (node.get("input")) {
        if (event.text && event.text?.length > 0) {
          insert(node, event.text);
        } else if (event.code === "Backspace") {
          deleteBackward(node);
        } else if (event.code === "Delete") {
          deleteForward(node);
        } else if (event.code === "ArrowLeft") {
          moveBack(node);
        } else if (event.code === "ArrowRight") {
          moveForward(node);
        } else if (event.code === "Home") {
          moveMin(node);
        } else if (event.code === "End") {
          moveMax(node);
        } else {
          next(node, event);
        }
      } else {
        next(node, event);
      }
    }
  })
}

function isKeyEvent(event: unknown): event is KeyEvent {
  const x = event as KeyEvent;
  //  console.log({ x, key: typeof x.key === "string", code: typeof x.code === "string", type: ["keyup", "keydown", "keyrepeat"].includes(x.type) });
  return !!x && typeof x.key === "string" && typeof x.code === "string" &&
    ["keyup", "keydown", "keyrepeat"].includes(x.type);
}

// Exported operation wrappers over the `Input` API. Each invokes the
// corresponding method at the node's scope so callers — the key dispatch above
// and any custom keymap — don't reach for `Input.invoke` directly.
export function insert(node: Node, text: string): void {
  Input.invoke(node.scope, "insert", [node, text]);
}

export function deleteBackward(node: Node): void {
  Input.invoke(node.scope, "deleteBackward", [node]);
}

export function deleteForward(node: Node): void {
  Input.invoke(node.scope, "deleteForward", [node]);
}

export function moveBack(node: Node): void {
  Input.invoke(node.scope, "moveBack", [node]);
}

export function moveForward(node: Node): void {
  Input.invoke(node.scope, "moveForward", [node]);
}

export function moveMin(node: Node): void {
  Input.invoke(node.scope, "moveMin", [node]);
}

export function moveMax(node: Node): void {
  Input.invoke(node.scope, "moveMax", [node]);
}

