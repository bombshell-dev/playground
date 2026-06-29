// oxlint-disable bombshell-dev/no-generic-error
// A counter rendered through the freedom-react reconciler to @bomb.sh/tty.
//
// Run it:  pnpm --filter @bomb.sh/freedom-react counter
//
// JSX (<box>/<text>/<button>) reconciles into a freedom tree; `walk` turns that
// tree into tty draw ops. Keypresses are routed through `root.dispatch`, so the
// button's handler runs inside the dispatch cycle and the resulting prop change
// flips the tree dirty -> the root stream notifies -> we redraw.
//
// onClick can't ride on props yet (the reconciler skips function props — that
// integration comes later), so the button registers its handler via the `ref`
// escape hatch: getPublicInstance returns the freedom node.
import { type ReactNode, useCallback, useState } from "react";
import { each, ensure, main, spawn, until } from "effection";
import { createRoot, DispatchApi, type Node } from "@bomb.sh/freedom";
import { mount } from "../src/index.ts";
import {
  alternateBuffer,
  close,
  createTerm,
  cursor,
  fit,
  grow,
  type KeyEvent,
  type Op,
  open,
  rgba,
  settings,
  text,
} from "@bomb.sh/tty";
import { stdin, stdout } from "node:process";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";

declare global {
  // oxlint-disable-next-line no-namespace
  namespace JSX {
    interface IntrinsicElements {
      box: { children?: ReactNode };
      text: { value?: string };
      button: { label?: string; ref?: (node: Node | null) => void };
    }
  }
}

const presses = new Map<Node, () => void>();

function Button(props: { label: string; onPress: () => void }): ReactNode {
  const ref = useCallback((node: Node | null) => {
    if (node) {
      presses.set(node, props.onPress);
    }
  }, [props.onPress]);
  return <button label={ props.label } ref = { ref } />;
}

function Counter(): ReactNode {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount((c) => c + 1), []);
  return (
    <box>
    <text value= {`Count: ${count}`
} />
  < text value = "" />
    <Button label="  +  " onPress = { increment } />
      <text value="" />
        <text value="space/enter to increment · ctrl-c to quit" />
          </box>
  );
}






































// Invoke the first button's registered handler.
function press(node: Node): void {
  for (const child of node.children) {
    if (child.name === "button") {
      presses.get(child)?.();
      return;
    }
    press(child);
  }
}

function isActivate(event: unknown): boolean {
  const e = event as KeyEvent;
  if (!e || e.type !== "keydown") {
    return false;
  }
  return e.key === " " || e.code === "Space" || e.code === "Enter" ||
    e.code === "Return";
}

// Turn the freedom tree into tty draw ops, dispatching on element name.
function walk(node: Node): Op[] {
  const kids: Op[] = [];
  for (const child of node.children) {
    kids.push(...walk(child));
  }
  switch (node.name) {
    case "box":
      return [
        open(node.id, {
          layout: {
            direction: "ttb",
            width: grow(),
            height: grow(),
            padding: { top: 1, right: 2, bottom: 1, left: 2 },
          },
          border: { color: rgba(255, 255, 255), top: 1, right: 1, bottom: 1, left: 1 },
        }),
        ...kids,
        close(),
      ];
    case "button":
      return [
        open(node.id, {
          layout: {
            width: fit(),
            height: fit(),
            padding: { top: 0, right: 1, bottom: 0, left: 1 },
          },
          border: { color: rgba(120, 200, 255), top: 1, right: 1, bottom: 1, left: 1 },
        }),
        text(String(node.props["label"] ?? "")),
        ...kids,
        close(),
      ];
    case "text":
      return [text(String(node.props["value"] ?? ""))];
    default:
      return kids;
  }
}

await main(function*() {
  if (!stdin.isTTY) {
    throw new Error("counter example requires an interactive TTY");
  }

  const root = createRoot();
  mount(<Counter />, root.node);

  // Route activation keys to the button inside the dispatch cycle, so the
  // resulting prop change is picked up by the dirty -> notify -> render loop.
  root.node.scope.around(DispatchApi, {
    *dispatch([event], next) {
      if (isActivate(event)) {
        press(root.node);
        return { ok: true, value: true };
      }
      return yield* next(event);
    },
  });

  const { columns, rows } = stdout.isTTY
    ? { columns: stdout.columns, rows: stdout.rows }
    : { columns: 80, rows: 24 };

  stdin.setRawMode(true);
  yield* ensure(() => {
    stdin.setRawMode(false);
    stdin.pause();
  });

  const bytes = yield* useStdin();
  const input = useInput(bytes);

  let term = yield* until(createTerm({ height: rows, width: columns }));

  const events = yield* spawn(function*() {
    for (const event of yield* each(input)) {
      if (event.type === "keydown" && event.ctrl && event.code === "c") {
        break;
      }
      if (event.type === "resize") {
        term = yield* until(createTerm({
          height: event.height,
          width: event.width,
        }));
      }

      root.dispatch(event);

      yield* each.next();
    }
  });

  function render(): void {
    const { output } = term.render(walk(root.node));
    stdout.write(output);
  }

  const tty = settings(cursor(false), alternateBuffer());

  try {
    stdout.write(tty.apply);

    render();
    yield* spawn(function*() {
      for (const _ of yield* each(root)) {
        render();
        yield* each.next();
      }
    });

    yield* events;
  } finally {
    stdout.write(tty.revert);
  }
});
