// oxlint-disable bombshell-dev/no-generic-error
import { each, ensure, main, sleep, spawn, until } from "effection";
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
  type Root,
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
  rgba,
  settings,
  text,
} from "@bomb.sh/tty";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { useInput } from "./use-input.ts";
import { useStdin } from "./use-stdin.ts";

const WHITE = rgba(255, 255, 255); // all text, and the focused border
const GRAY = rgba(100, 100, 100); // unfocused border only

const FRAME = 16; // ms between render frames (~60fps)

// Synchronous input API. Core methods are no-ops; behaviour is installed by
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

// The centering screen: holds the form box in the middle of the terminal.
function screenBody({ node, children }: LayoutOptions): Op[] {
  return [
    open(node.id, {
      layout: { width: grow(), height: grow(), alignX: "center", alignY: "center" },
    }),
    ...children,
    close(),
  ];
}

// The titled, bordered form panel.
function formBody({ node, children }: LayoutOptions): Op[] {
  return [
    open(node.id, {
      border: { color: WHITE, top: 1, right: 1, bottom: 1, left: 1 },
      layout: {
        direction: "ttb",
        width: fit(48),
        height: fit(),
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        gap: 1,
      },
    }),
    text("Pizza Order", { color: WHITE }),
    ...children,
    close(),
  ];
}

// A labelled text input. Focused: white border + a background that eases in.
function makeField(node: Node, label: string): void {
  focusable(node);
  node.set("label", label);
  node.set("value", "");
  layout(node, () => {
    const border = node.props.focused === true ? WHITE : GRAY;
    return [
      open(`${node.id}-field`, {
        layout: { direction: "ttb", width: grow(), padding: { left: 1, right: 1 } },
      }),
      text(label, { color: WHITE }),
      open(node.id, {
        border: { color: border, top: 1, right: 1, bottom: 1, left: 1 },
        layout: {
          width: grow(),
          height: fit(3),
          padding: { top: 1, right: 1, bottom: 1, left: 1 },
        },
      }),
      text(String(node.props.value ?? ""), { color: WHITE }),
      close(),
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

// A single-line activatable control (link/button). Focused shows `› text ‹`
// over a background that eases in.
function makeControl(node: Node, label: string): void {
  focusable(node);
  node.set("label", label);
  layout(node, () => {
    const focused = node.props.focused === true;
    // Reserve the caret columns in both states so the label never shifts.
    const content = focused ? `› ${label} ‹` : `  ${label}  `;
    return [
      open(node.id, {
        layout: { width: grow(), padding: { left: 1, right: 1 } },
      }),
      text(content, { color: WHITE }),
      close(),
    ];
  });
}

// Build the pizza form's node tree: a centered panel holding two text fields
// and two activatable controls, with Tab/Backtab focus navigation installed.
export function buildPizza(): Root {
  const root = createRoot();

  // Demux: route keyboard events to the focused node's input chain.
  root.node.scope.around(DispatchApi, {
    *dispatch([event], next) {
      if (isKeyboardEvent(event)) {
        InputApi.invoke(current(root.node).scope, event.type, [event]);
        return { ok: true, value: true };
      } else {
        return yield* next(event);
      }
    },
  });

  // Tab/Backtab navigation, bubbled up from controls that don't consume the key.
  function tab([event]: [KeyEvent], next: (event: KeyEvent) => void): void {
    if (event.code === "Tab") {
      advance(root.node);
    } else if (event.code === "Backtab") {
      retreat(root.node);
    } else {
      next(event);
    }
  }
  root.node.scope.around(InputApi, { keydown: tab, keyrepeat: tab });

  layout(root.node, screenBody);

  const panel = root.node.createChild("form");
  layout(panel, formBody);

  makeField(panel.createChild("name"), "Name");
  makeField(panel.createChild("address"), "Address");
  makeControl(panel.createChild("card"), "Add card");
  makeControl(panel.createChild("submit"), "Submit");

  useFocus(root.node); // seed focus now that focusable controls exist (name)

  return root;
}

export function walk(node: Node): Op[] {
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

function* run() {
  if (!stdin.isTTY) {
    throw new Error("pizza demo requires an interactive TTY");
  }

  const root = buildPizza();

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

  let last = performance.now();
  function render(): void {
    const now = performance.now();
    const delta = now - last;
    last = now;
    const { output } = term.render(walk(root.node), { deltaTime: delta });
    if (output.length > 0) {
      stdout.write(output);
    }
  }

  const tty = settings(cursor(false), alternateBuffer());

  try {
    stdout.write(tty.apply);

    // Sole renderer: a frame ticker. Idle re-renders diff to zero bytes, so
    // this is cheap when nothing changes and drives transitions when they do.
    yield* spawn(function* () {
      while (true) {
        render();
        yield* sleep(FRAME);
      }
    });

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
  } finally {
    stdout.write(tty.revert);
  }
}

// Run the IO loop only when executed directly, not when imported for testing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(run);
}
