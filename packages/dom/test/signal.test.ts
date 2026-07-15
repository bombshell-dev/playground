import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from '../test/suite.ts';
import { createRoot, FocusManager, type Node, type Root } from '../src/index.ts';

function addChild(root: Root, parent: Node, localName: string, tabindex?: number): Node {
	const node = root.createElement(localName);
	if (tabindex !== undefined) {
		node.setAttribute('tabindex', tabindex);
	}
	parent.append(node);
	return node;
}

describe('node.signal', () => {
	it('is a live AbortSignal while the node is alive', () => {
		const root = createRoot();
		const child = addChild(root, root.documentElement, 'child');
		expect(child.signal).toBeInstanceOf(AbortSignal);
		expect(child.signal.aborted).toBe(false);
		root.destroy();
	});

	it('aborts when the node is removed; siblings are untouched', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'a');
		const b = addChild(root, root.documentElement, 'b');
		a.remove();
		expect(a.signal.aborted).toBe(true);
		expect(b.signal.aborted).toBe(false);
		expect(root.documentElement.signal.aborted).toBe(false);
		root.destroy();
	});

	it('stays live across moves — relocation is not removal', () => {
		const root = createRoot();
		const left = addChild(root, root.documentElement, 'left');
		const right = addChild(root, root.documentElement, 'right');
		const item = addChild(root, left, 'item');
		right.append(item); // move
		expect(item.signal.aborted).toBe(false);
		root.documentElement.insertBefore(item, left); // move again
		expect(item.signal.aborted).toBe(false);
		root.destroy();
	});

	it('aborts descendants depth-first, children before parents', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'a');
		const inner = addChild(root, a, 'inner');
		const innermost = addChild(root, inner, 'innermost');
		const order: string[] = [];
		for (const [name, node] of [
			['a', a],
			['inner', inner],
			['innermost', innermost],
		] as const) {
			node.signal.addEventListener('abort', () => order.push(name));
		}
		a.remove();
		expect(order).toEqual(['innermost', 'inner', 'a']);
		root.destroy();
	});

	it('root.destroy aborts the whole tree', () => {
		const root = createRoot();
		const a = addChild(root, root.documentElement, 'a');
		const inner = addChild(root, a, 'inner');
		root.destroy();
		expect(root.documentElement.signal.aborted).toBe(true);
		expect(a.signal.aborted).toBe(true);
		expect(inner.signal.aborted).toBe(true);
	});

	it('cleans up ancestor listeners registered with { signal } (delegation)', () => {
		const root = createRoot();
		const child = addChild(root, root.documentElement, 'child');
		let count = 0;
		// A listener the child installs on the root, scoped to the child's life.
		root.documentElement.addEventListener('ping', () => count++, {
			signal: child.signal,
		});
		child.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(count).toEqual(1);
		child.remove();
		root.documentElement.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(count).toEqual(1);
		root.destroy();
	});

	it('cancels node-scoped timers on removal', async () => {
		const root = createRoot();
		const spinner = addChild(root, root.documentElement, 'spinner');
		const outcome = delay(1_000, 'completed', { signal: spinner.signal }).catch(
			(error: Error) => error.name,
		);
		spinner.remove();
		expect(await outcome).toEqual('AbortError');
		root.destroy();
	});

	it('stops a node-scoped async loop (the spinner pattern)', async () => {
		const root = createRoot();
		const spinner = addChild(root, root.documentElement, 'spinner');
		let frames = 0;
		const loop = (async () => {
			try {
				while (true) {
					spinner.setAttribute('frame', frames++);
					await delay(1, undefined, { signal: spinner.signal });
				}
			} catch {
				// aborted — the node was removed
			}
		})();
		await delay(10);
		spinner.remove();
		await loop;
		const after = frames;
		await delay(10);
		expect(frames).toEqual(after); // no ticks after removal
		expect(frames).toBeGreaterThan(0);
		root.destroy();
	});

	it('a FocusManager scoped to a container dies with it', () => {
		const root = createRoot();
		const panel = addChild(root, root.documentElement, 'panel');
		const a = addChild(root, panel, 'A', 0);
		addChild(root, panel, 'B', 0);
		const focus = new FocusManager(panel); // seeds A, manages removals within panel
		expect(focus.activeElement).toBe(a);
		panel.remove();
		expect(panel.signal.aborted).toBe(true);
		// pointer cleared, listener dead via panel.signal; falls back to its root
		expect(focus.activeElement).toBe(panel);
		root.destroy();
	});
});
