// oxlint-disable bombshell-dev/no-generic-error
import { each, ensure, main, spawn, until } from "effection";
import { createApi } from "effection/experimental";
import {
  advance,
  createNodeData,
  createRoot,
  current,
  DispatchApi,
  focusable,
  type Node,
  retreat,
  useFocus,
} from "@bomb.sh/freedom";
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
  percent,
  rgba,
  settings,
  text,
} from "@bomb.sh/tty";
import { stdin, stdout } from "node:process";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";

const GRAY = rgba(100, 100, 100);

// Synchronous input API. Core methods are no-ops; behavior is installed by
// interceptors on each node's scope and invoked at the focused node.
const InputApi = createApi("demo:input", {
  keydown(_event: KeyEvent): void {},
  keyup(_event: KeyEvent): void {},
  keyrepeat(_event: KeyEvent): void {},
});

interface LayoutOptions {
  node: Node;
  children: Iterable<Op>;
}

const layoutKey = createNodeData<(options: LayoutOptions) => Op[]>(
  "demo:layout",
  () => [],
);

function layout(node: Node, body: (options: LayoutOptions) => Op[]): void {
  node.data.set(layoutKey, body);
}

function makeTextInput(node: Node): void {
  focusable(node);
  node.set("value", "");
  layout(node, () => {
    const color = node.props.focused ? rgba(255, 255, 255) : GRAY;
    const border = { color, top: 1, right: 1, bottom: 1, left: 1 };
    return [
      open(node.id, {
        border,
        layout: {
          height: fit(3),
          width: percent(0.3),
          padding: { top: 1, right: 1, bottom: 1, left: 1 },
        },
      }),
      text(String(node.props.value ?? "")),
      close(),
    ];
  });
  node.scope.around(InputApi, {
    keydown([event], next) {
      if (event.key.length === 1) {
        node.update("value", (v) => `${v ?? ""}${event.key}`);
      } else if (event.code === "Backspace") {
        node.update("value", (v) => String(v ?? "").slice(0, -1));
      } else {
        next(event);
      }
    },
  });
}

function screenBody({ node, children }: LayoutOptions): Op[] {
  return [
    open(node.id, {
      layout: {
        height: grow(),
        width: grow(),
        direction: "ttb",
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      border: {
        color: rgba(255, 255, 255),
        top: 1,
        right: 1,
        bottom: 1,
        left: 1,
      },
    }),
    ...children,
    close(),
  ];
}

function containerBody({ node, children }: LayoutOptions): Op[] {
  return [
    open(node.id, {
      border: { color: 0xFFF, top: 1, right: 1, bottom: 1, left: 1 },
      layout: {
        height: fit(),
        width: grow(),
        direction: "ttb",
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
      },
    }),
    ...children,
    close(),
  ];
}

await main(function* () {
  if (!stdin.isTTY) {
    throw new Error("freedom demo requires an interactive TTY");
  }

  const root = createRoot();

  // Demux: route keyboard events to the focused node's input chain.
  root.node.scope.around(DispatchApi, {
    *dispatch([event], next) {
      if (isKeyboardEvent(event)) {
        InputApi.invoke(current(root.node).scope, event.type, [event]);
        return { ok: true, value: true };
      }
      return yield* next(event);
    },
  });

  // Tab/Backtab navigation, bubbled up from inputs that don't consume the key.
  root.node.scope.around(InputApi, {
    keydown([event], next) {
      if (event.code === "Tab") {
        advance(root.node);
      } else if (event.code === "Backtab") {
        retreat(root.node);
      } else {
        next(event);
      }
    },
    keyrepeat([event], next) {
      if (event.code === "Tab") {
        advance(root.node);
      } else if (event.code === "Backtab") {
        retreat(root.node);
      } else {
        next(event);
      }
    },
  });

  layout(root.node, screenBody);

  const container = root.node.createChild("input-1");
  layout(container, containerBody);

  makeTextInput(container.createChild("input-1-1"));
  makeTextInput(container.createChild("input-1-2"));
  makeTextInput(root.node.createChild("input-2"));

  useFocus(root.node); // seed focus now that focusable inputs exist (input-1-1)

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

  const events = yield* spawn(function* () {
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
    const ops = walk(root.node);
    const { output } = term.render(ops);
    stdout.write(output);
  }

  const tty = settings(cursor(false), alternateBuffer());

  try {
    stdout.write(tty.apply);

    render();
    yield* spawn(function* () {
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

function walk(node: Node): Op[] {
  const children: Op[] = [];
  for (const child of node.children) {
    children.push(...walk(child));
  }
  const body = node.data.get(layoutKey);
  return body ? body({ node, children }) : children;
}

function isKeyboardEvent(event: unknown): event is KeyEvent {
  const x = event as KeyEvent;
  return !!x && typeof x.key === "string" && typeof x.code === "string" &&
    ["keyup", "keydown", "keyrepeat"].includes(x.type);
}
