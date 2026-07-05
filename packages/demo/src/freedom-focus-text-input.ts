// oxlint-disable bombshell-dev/no-generic-error
import { each, ensure, main, spawn, until } from "effection";
import {
  advance,
  createNodeData,
  createRoot,
  type Node,
  retreat,
  useFocus,
} from "@bomb.sh/freedom";
import {
  initInput,
  KeyboardApi,
  useInput,
  useReadlineKeymap,
} from "@bomb.sh/input";
import {
  alternateBuffer,
  close,
  createTerm,
  cursor,
  fit,
  grow,
  type Op,
  open,
  percent,
  rgba,
  settings,
  text,
} from "@bomb.sh/tty";
import { stdin, stdout } from "node:process";
import { useInput as decodeBytes } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";
import { logKeys } from "./key-logger.ts";

const GRAY = rgba(100, 100, 100);

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

// A bordered text input. Editing, caret, and focus state come from
// `@bomb.sh/input` (`makeInput`); the demo owns only how it's drawn. The focused
// input passes its `caret` (a code-point offset) to `text()`, so tty positions
// the terminal's native cursor there rather than drawing a glyph.
function textInput(node: Node): void {
  initInput(node);
  layout(node, () => {
    const focused = node.props.focused;
    const value = String(node.props.value ?? "");
    const caret = Math.min(Number(node.props.caret ?? 0), [...value].length);
    const color = focused ? rgba(255, 255, 255) : GRAY;
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
      // An empty focused field has no cell for the native cursor, so render a
      // single space to give the caret at 0 somewhere to sit.
      focused ? text(value || " ", { caret }) : text(value),
      close(),
    ];
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

  logKeys(root.node);

  // Route keyboard events to the focused input's editing behavior.
  useInput(root);
  useReadlineKeymap(root.node);

  // Debug: log every key + resulting value/caret to `input-keylog.jsonl`.
  // Installed first so it wraps everything below. Comment out to disable.

  // Tab/Backtab move focus between inputs. Installed at the root scope so it
  // wraps the focused input's editing behavior (root is an ancestor of where
  // `KeyboardApi` is invoked): Tab/Backtab are consumed here, every other key
  // falls through via `next` to the input.
  root.node.scope.around(KeyboardApi, {
    keydown([node, event], next) {
      if (event.code === "Tab") {
        advance(root.node);
      } else if (event.code === "Backtab") {
        retreat(root.node);
      } else {
        next(node, event);
      }
    },
    keyrepeat([node, event], next) {
      if (event.code === "Tab") {
        advance(root.node);
      } else if (event.code === "Backtab") {
        retreat(root.node);
      } else {
        next(node, event);
      }
    },
  });

  layout(root.node, screenBody);

  const container = root.node.createChild("input-1");
  layout(container, containerBody);

  textInput(container.createChild("input-1-1"));
  textInput(container.createChild("input-1-2"));
  textInput(root.node.createChild("input-2"));

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
  const stream = decodeBytes(bytes);

  let term = yield* until(createTerm({ height: rows, width: columns }));

  const events = yield* spawn(function* () {
    for (const event of yield* each(stream)) {
      if (event.type === "keydown" && event.ctrl && event.code === "c") {
        break;
      }
      if (event.type === "resize") {
        term = yield* until(createTerm({
          height: event.height,
          width: event.width,
        }));
        render();
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

  const tty = settings(cursor(true), alternateBuffer());

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
