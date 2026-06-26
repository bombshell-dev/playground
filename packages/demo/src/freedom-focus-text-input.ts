// oxlint-disable require-yield
// oxlint-disable bombshell-dev/no-generic-error
import { each, ensure, main, type Operation, spawn, until } from "effection";
import { createApi } from "effection/experimental";
import {
  advance,
  append,
  createNodeData,
  current,
  DispatchApi,
  focusable,
  type Node,
  retreat,
  set,
  type Tree,
  update,
  useFocus,
  useNode,
  useTree,
} from "@bomb.sh/freedom";
import {
  alternateBuffer,
  close,
  createTerm,
  cursor,
  fit,
  grow,
  type KeyDown,
  type KeyEvent,
  type KeyRepeat,
  type KeyUp,
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

const InputApi = createApi("demo:input", {
  *keydown(event: KeyDown): Operation<void> {
    if (event.code === "Tab") {
      yield* advance();
    } else if (event.code === "Backtab") {
      yield* retreat();
    }
  },
  *keyup(_event: KeyUp): Operation<void> {
    // no-op
  },
  *keyrepeat(event: KeyRepeat): Operation<void> {
    if (event.code === "Tab") {
      yield* advance();
    } else if (event.code === "Backtab") {
      yield* retreat();
    }
  },
});

function onkeydown(
  handler: (
    event: KeyDown,
    next: (event: KeyDown) => Operation<void>,
  ) => Operation<void>,
): Operation<void> {
  return InputApi.around({
    keydown([event], next) {
      return handler(event, next);
    },
  });
}

interface LayoutOptions {
  node: Node;
  children: Iterable<Op>;
}

const layoutKey = createNodeData<(options: LayoutOptions) => Op[]>(
  "demo:layout",
  () => [],
);

function* layout(body: (props: LayoutOptions) => Op[]): Operation<void> {
  const node = yield* useNode();
  node.data.set(layoutKey, body);
}

function* useTextInput(): Operation<void> {
  yield* focusable();
  yield* set("value", "");
  yield* onkeydown(function* (event, next) {
    if (event.key.length === 1) {
      yield* update("value", (v) => `${v ?? ""}${event.key}`);
    } else if (event.code === "Backspace") {
      yield* update("value", (v) => {
        const str = String(v ?? "");
        return str.slice(0, -1);
      });
    } else {
      yield* next(event);
    }
  });
}

await main(function* () {
  if (!stdin.isTTY) {
    throw new Error("freedom demo requires an interactive TTY");
  }

  const tree = yield* useTree(function* () {
    yield* useFocus();
    yield* layout(({ node, children }) => {
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
    });

    yield* DispatchApi.around({
      *dispatch([event], next) {
        if (isKeyboardEvent(event)) {
          const focus = yield* current();
          const result = yield* focus.eval(function* () {
            const handler = InputApi.operations[event.type];
            yield* handler(event as KeyDown & KeyUp & KeyRepeat);
          });
          return result.ok ? { ok: true, value: true } : result;
        }
        return yield* next(event);
      },
    });

    yield* append("input-1", function* () {
      yield* layout(({ node, children }) => {
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
      });

      yield* append("input-1-1", function* () {
        yield* useTextInput();
        yield* layout(({ node }) => {
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
      });

      yield* append("input-1-2", function* () {
        yield* useTextInput();
        yield* layout(({ node }) => {
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
      });
    });

    yield* append("input-2", function* () {
      yield* useTextInput();
      yield* layout(({ node }) => {
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
    });
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

      tree.dispatch(event);

      yield* each.next();
    }
  });

  function render(tree: Tree) {
    const ops = walk(tree.root);
    const { output } = term.render(ops);
    stdout.write(output);
  }

  const tty = settings(cursor(false), alternateBuffer());

  try {
    stdout.write(tty.apply);

    render(tree);
    yield* spawn(function* () {
      for (const _ of yield* each(tree)) {
        render(tree);
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
