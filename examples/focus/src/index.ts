// oxlint-disable bombshell-dev/no-generic-error
import {
	createNodeData,
	createRoot,
	FocusGroupManager,
	FocusManager,
	type Node,
	type Root,
} from '@bomb.sh/dom';
import {
	alternateBuffer,
	close,
	createInput,
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
} from '@bomb.sh/tty';
import { stdin, stdout } from 'node:process';

const GRAY = rgba(100, 100, 100);

// Terminal key events, carried on the standard Event vocabulary. Bubbling
// does the routing: an input consumes a key with stopPropagation(); anything
// it ignores reaches the root handler.
class KeyboardEvent extends Event {
	constructor(readonly detail: KeyEvent) {
		super(detail.type, { bubbles: true, cancelable: true });
	}
}

interface LayoutOptions {
	node: Node;
	children: Iterable<Op>;
}

const layoutKey = createNodeData<(options: LayoutOptions) => Op[]>('demo:layout', () => []);

function layout(node: Node, body: (options: LayoutOptions) => Op[]): void {
	node.data.set(layoutKey, body);
}

function makeTextInput(root: Root, parent: Node, name: string): void {
	const node = root.createElement(name);
	parent.append(node);
	node.setAttribute('tabindex', 0);
	node.setAttribute('value', '');
	layout(node, () => {
		const color = node.states.has('focus') ? rgba(255, 255, 255) : GRAY;
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
			text(String(node.getAttribute('value') ?? '')),
			close(),
		];
	});
	node.addEventListener('keydown', (event) => {
		const { key, code } = (event as KeyboardEvent).detail;
		const value = String(node.getAttribute('value') ?? '');
		if (key.length === 1) {
			node.setAttribute('value', `${value}${key}`);
			event.stopPropagation();
		} else if (code === 'Backspace') {
			node.setAttribute('value', value.slice(0, -1));
			event.stopPropagation();
		}
		// anything else bubbles up to the root Tab/Backtab/arrow handler
	});
}

function screenBody({ node, children }: LayoutOptions): Op[] {
	return [
		open(node.id, {
			layout: {
				height: grow(),
				width: grow(),
				direction: 'ttb',
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
			border: { color: 0xfff, top: 1, right: 1, bottom: 1, left: 1 },
			layout: {
				height: fit(),
				width: grow(),
				direction: 'ttb',
				padding: { top: 1, right: 1, bottom: 1, left: 1 },
			},
		}),
		...children,
		close(),
	];
}

function walk(node: Node): Op[] {
	const children: Op[] = [];
	for (const child of node.children) {
		children.push(...walk(child));
	}
	const body = node.data.get(layoutKey);
	return body ? body({ node, children }) : children;
}

if (!stdin.isTTY) {
	throw new Error('dom demo requires an interactive TTY');
}

const root = createRoot();

layout(root.documentElement, screenBody);

const container = root.createElement('input-1');
root.documentElement.append(container);
layout(container, containerBody);

makeTextInput(root, container, 'input-1-1');
makeTextInput(root, container, 'input-1-2');
makeTextInput(root, root.documentElement, 'input-2');

// document.activeElement analog; seeds focus now that inputs exist (input-1-1).
const focus = new FocusManager(root.documentElement);

// The two grouped inputs collapse into a single Tab stop, entered at the
// last-focused input (memory). ArrowUp/ArrowDown move within the group —
// listbox defaults: block axis, no wrap.
const group = new FocusGroupManager(focus, container, 'listbox');

// Tab/Backtab/arrow navigation lives at the root; it only sees keys the
// focused input let bubble. The group methods no-op while focus is outside
// the group, so binding them here is safe.
const navigate = (event: Event): void => {
	const { code } = (event as KeyboardEvent).detail;
	if (code === 'Tab') {
		focus.next();
	} else if (code === 'Backtab') {
		focus.previous();
	} else if (code === 'ArrowDown') {
		group.next();
	} else if (code === 'ArrowUp') {
		group.previous();
	}
};
root.documentElement.addEventListener('keydown', navigate);
root.documentElement.addEventListener('keyrepeat', navigate);

const { columns, rows } = stdout.isTTY
	? { columns: stdout.columns, rows: stdout.rows }
	: { columns: 80, rows: 24 };

let term = await createTerm({ height: rows, width: columns });

function render(): void {
	const ops = walk(root.documentElement);
	const { output } = term.render(ops);
	stdout.write(output);
}

root.addEventListener('change', render);

const tty = settings(cursor(false), alternateBuffer());
stdin.setRawMode(true);
stdout.write(tty.apply);

function shutdown(): void {
	stdout.write(tty.revert);
	stdin.setRawMode(false);
	stdin.off('data', feed);
	stdin.pause();
}

const input = await createInput();
let rescan: ReturnType<typeof setTimeout> | undefined;

function feed(bytes: Uint8Array): void {
	clearTimeout(rescan);
	const result = input.scan(bytes);
	if (result.pending) {
		rescan = setTimeout(() => feed(new Uint8Array()), result.pending.delay);
	}
	for (const event of result.events) {
		if (event.type === 'keydown' && event.ctrl && event.code === 'c') {
			shutdown();
			return;
		}
		if (event.type === 'resize') {
			void createTerm({ height: event.height, width: event.width }).then((next) => {
				term = next;
				render();
			});
			continue;
		}
		// All the input routing: dispatch at the focused node; capture, target,
		// and bubble listeners do the rest.
		focus.activeElement.dispatchEvent(new KeyboardEvent(event as KeyEvent));
	}
}
stdin.on('data', feed);

render();
