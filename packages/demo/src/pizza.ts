// oxlint-disable bombshell-dev/no-generic-error
import { each, ensure, main, spawn, until } from "effection";
import {
  advance,
  createNodeData,
  createRoot,
  focusable,
  focusPush,
  type Node,
  retreat,
  type Root,
  useFocus,
} from "@bomb.sh/freedom";
import {
  initInput,
  KeyboardApi,
  useInput as installInput,
  useReadlineKeymap,
} from "@bomb.sh/input";
import {
  alternateBuffer,
  close,
  createTerm,
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
    text("Pizza Delivery", { color: WHITE }),
    ...children,
    close(),
  ];
}

// A labelled text input. Readline editing is provided by @bomb.sh/input; the
// focused field renders a native cursor via the value text's `caret`.
function makeField(node: Node, label: string): void {
  initInput(node); // focusable + input:true + value:"" + caret:0
  layout(node, () => {
    const focused = node.props.focused === true;
    const border = focused ? WHITE : GRAY;
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
      text(String(node.props.value ?? ""), {
        color: WHITE,
        caret: focused ? Number(node.props.caret ?? 0) : undefined,
      }),
      close(),
      close(),
    ];
  });
}

// A single-line activatable control (link/button). Focused shows `› text ‹`
// over a background that eases in.
function makeControl(node: Node, label: string): void {
  focusable(node);
  node.set("label", label);
  layout(node, () => {
    const focused = node.props.focused === true;
    const caption = String(node.props.label ?? "");
    // Reserve the caret columns in both states so the label never shifts.
    const content = focused ? `› ${caption} ‹` : `  ${caption}  `;
    return [
      open(node.id, {
        layout: { width: grow(), padding: { left: 1, right: 1 } },
      }),
      text(content, { color: WHITE }),
      close(),
    ];
  });
}

// Fire `onActivate` when the focused control receives Enter or Space; other
// keys bubble so Tab/Backtab still navigate.
function activatable(node: Node, onActivate: () => void): void {
  node.scope.around(KeyboardApi, {
    keydown([n, event], next) {
      if (event.code === "Enter" || event.code === " ") {
        onActivate();
      } else {
        next(n, event);
      }
    },
  });
}

// The credit-card modal: a floating panel centered over (and occluding) the
// form, on top via zIndex. Its own focus root traps Tab/Backtab (§12).
function cardModalBody({ node, children }: LayoutOptions): Op[] {
  return [
    open(node.id, {
      border: { color: WHITE, top: 1, right: 1, bottom: 1, left: 1 },
      bg: rgba(0, 0, 0),
      floating: {
        attachTo: "root",
        attachPoints: { element: "center-center", parent: "center-center" },
        zIndex: 10,
      },
      layout: {
        direction: "ttb",
        width: fit(40),
        height: fit(),
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        gap: 1,
      },
    }),
    text("Card details", { color: WHITE }),
    ...children,
    close(),
  ];
}

function isConfirmed(value: unknown): value is { last4: string } {
  return !!value && typeof value === "object" && "last4" in value;
}

// Open the card modal: build its subtree, push it as the focus root, and wire
// Cancel/Confirm to pop with a result the push callback acts on.
function openCardModal(root: Root, card: Node): void {
  const modal = root.node.createChild("card-modal");
  layout(modal, cardModalBody);
  const number = modal.createChild("card-number");
  makeField(number, "Card number");
  makeField(modal.createChild("expiry"), "Expiry");
  makeField(modal.createChild("cvc"), "CVC");
  const cancel = modal.createChild("cancel");
  makeControl(cancel, "Cancel");
  const confirm = modal.createChild("confirm");
  makeControl(confirm, "Confirm");

  const pop = focusPush(modal, (value) => {
    if (isConfirmed(value)) {
      card.set("label", `Edit card •••• ${value.last4}`);
    }
    void modal.remove(); // focus already restored to the card link
  });

  activatable(cancel, () => pop({ cancelled: true }));
  activatable(confirm, () => {
    const digits = String(number.props.value ?? "").replace(/\D/g, "");
    pop({ last4: digits.slice(-4) || "????" });
  });
}

// Build the pizza form's node tree: a centered panel holding two text fields
// and two activatable controls, with Tab/Backtab focus navigation installed.
export function buildPizza(): Root {
  const root = createRoot();

  // Demux + readline editing (insert-at-caret, Backspace/Delete, arrows,
  // Home/End) from @bomb.sh/input, plus its emacs Ctrl-A/E/F/B/D keymap.
  installInput(root);
  useReadlineKeymap(root.node);

  // Tab/Backtab navigation, bubbled up from nodes that don't consume the key.
  function tab([node, event]: [Node, KeyEvent], next: (node: Node, event: KeyEvent) => void): void {
    if (event.code === "Tab") {
      advance(root.node);
    } else if (event.code === "Backtab") {
      retreat(root.node);
    } else {
      next(node, event);
    }
  }
  root.node.scope.around(KeyboardApi, { keydown: tab });

  layout(root.node, screenBody);

  const panel = root.node.createChild("form");
  layout(panel, formBody);

  makeField(panel.createChild("name"), "Name");
  makeField(panel.createChild("address"), "Address");
  const card = panel.createChild("card");
  makeControl(card, "Add card");
  activatable(card, () => openCardModal(root, card));
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

  function render(): void {
    const { output } = term.render(walk(root.node), { deltaTime: 0 });
    if (output.length > 0) {
      stdout.write(output);
    }
  }

  const tty = settings(alternateBuffer()); // native cursor shown via text carets

  try {
    stdout.write(tty.apply);

    // Event-driven: paint once, then only when the tree changes. Rendering
    // every frame would re-emit the cursor position each tick and reset the
    // terminal's blink timer, so an idle cursor would never blink.
    render();
    yield* spawn(function* () {
      for (const _ of yield* each(root)) {
        render();
        yield* each.next();
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
        render();
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
