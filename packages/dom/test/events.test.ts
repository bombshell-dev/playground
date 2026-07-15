import { describe, expect, it } from '../test/suite.ts';
import { createRoot, type Node, type Root } from '../src/index.ts';

// A three-deep tree: documentElement -> mid -> leaf.
function tree(): { root: Root; top: Node; mid: Node; leaf: Node } {
	const root = createRoot();
	const top = root.documentElement;
	const mid = root.createElement('mid');
	const leaf = root.createElement('leaf');
	mid.append(leaf);
	top.append(mid);
	return { root, top, mid, leaf };
}

describe('dispatch at a target', () => {
	it('invokes listeners on the target with correct identity', () => {
		const { root, leaf } = tree();
		const seen: { target: unknown; currentTarget: unknown; phase: number }[] = [];
		leaf.addEventListener('ping', (event) => {
			seen.push({
				target: event.target,
				currentTarget: event.currentTarget,
				phase: event.eventPhase,
			});
		});
		const handled = leaf.dispatchEvent(new Event('ping'));
		expect(handled).toBe(true);
		expect(seen).toEqual([{ target: leaf, currentTarget: leaf, phase: Event.AT_TARGET }]);
		root.destroy();
	});

	it('returns false when preventDefault is called on a cancelable event', () => {
		const { root, leaf } = tree();
		leaf.addEventListener('ping', (event) => event.preventDefault());
		expect(leaf.dispatchEvent(new Event('ping', { cancelable: true }))).toBe(false);
		root.destroy();
	});

	it('custom Event subclasses pass through untouched', () => {
		class KeyEvent extends Event {
			constructor(readonly key: string) {
				super('keydown', { bubbles: true });
			}
		}
		const { root, top, leaf } = tree();
		let key = '';
		top.addEventListener('keydown', (event) => {
			key = (event as KeyEvent).key;
		});
		leaf.dispatchEvent(new KeyEvent('a'));
		expect(key).toEqual('a');
		root.destroy();
	});
});

describe('bubbling', () => {
	it('bubbles target -> mid -> top in order', () => {
		const { root, top, mid, leaf } = tree();
		const order: string[] = [];
		for (const [name, node] of [
			['top', top],
			['mid', mid],
			['leaf', leaf],
		] as const) {
			node.addEventListener('ping', (event) => {
				order.push(`${name}:${event.eventPhase}`);
				expect(event.target).toBe(leaf);
				expect(event.currentTarget).toBe(node);
			});
		}
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(order).toEqual([
			`leaf:${Event.AT_TARGET}`,
			`mid:${Event.BUBBLING_PHASE}`,
			`top:${Event.BUBBLING_PHASE}`,
		]);
		root.destroy();
	});

	it("non-bubbling events do not reach ancestors' bubble listeners", () => {
		const { root, top, leaf } = tree();
		let topSaw = false;
		top.addEventListener('ping', () => {
			topSaw = true;
		});
		leaf.dispatchEvent(new Event('ping'));
		expect(topSaw).toBe(false);
		root.destroy();
	});

	it('stopPropagation halts ancestors but finishes the current node', () => {
		const { root, top, mid, leaf } = tree();
		const order: string[] = [];
		leaf.addEventListener('ping', (event) => {
			order.push('leaf-1');
			event.stopPropagation();
		});
		leaf.addEventListener('ping', () => order.push('leaf-2'));
		mid.addEventListener('ping', () => order.push('mid'));
		top.addEventListener('ping', () => order.push('top'));
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(order).toEqual(['leaf-1', 'leaf-2']);
		root.destroy();
	});

	it('stopImmediatePropagation halts remaining listeners on the same node too', () => {
		const { root, top, leaf } = tree();
		const order: string[] = [];
		leaf.addEventListener('ping', (event) => {
			order.push('leaf-1');
			event.stopImmediatePropagation();
		});
		leaf.addEventListener('ping', () => order.push('leaf-2'));
		top.addEventListener('ping', () => order.push('top'));
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(order).toEqual(['leaf-1']);
		root.destroy();
	});

	it('stopPropagation in a bubble listener halts remaining ancestors', () => {
		const { root, top, mid, leaf } = tree();
		const order: string[] = [];
		mid.addEventListener('ping', (event) => {
			order.push('mid');
			event.stopPropagation();
		});
		top.addEventListener('ping', () => order.push('top'));
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(order).toEqual(['mid']);
		root.destroy();
	});

	it('preventDefault anywhere on the path makes dispatchEvent return false', () => {
		const { root, top, leaf } = tree();
		top.addEventListener('ping', (event) => event.preventDefault());
		const handled = leaf.dispatchEvent(new Event('ping', { bubbles: true, cancelable: true }));
		expect(handled).toBe(false);
		root.destroy();
	});
});

describe('capture phase', () => {
	it('capture runs top -> mid before target, bubble runs after', () => {
		const { root, top, mid, leaf } = tree();
		const order: string[] = [];
		top.addEventListener('ping', () => order.push('top-capture'), { capture: true });
		mid.addEventListener('ping', () => order.push('mid-capture'), { capture: true });
		leaf.addEventListener('ping', () => order.push('leaf'));
		mid.addEventListener('ping', () => order.push('mid-bubble'));
		top.addEventListener('ping', () => order.push('top-bubble'));
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(order).toEqual(['top-capture', 'mid-capture', 'leaf', 'mid-bubble', 'top-bubble']);
		root.destroy();
	});

	it('capture listeners see non-bubbling events (delegation trick)', () => {
		const { root, top, leaf } = tree();
		const order: string[] = [];
		top.addEventListener('focus', () => order.push('top-capture'), { capture: true });
		top.addEventListener('focus', () => order.push('top-bubble'));
		leaf.dispatchEvent(new Event('focus'));
		expect(order).toEqual(['top-capture']);
		root.destroy();
	});

	it('bubble listeners do not fire during the capture walk', () => {
		const { root, mid, leaf } = tree();
		const phases: number[] = [];
		mid.addEventListener('ping', (event) => phases.push(event.eventPhase));
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(phases).toEqual([Event.BUBBLING_PHASE]);
		root.destroy();
	});

	it('at the target, capture and bubble listeners both fire in add order', () => {
		const { root, leaf } = tree();
		const order: string[] = [];
		leaf.addEventListener('ping', () => order.push('bubble'));
		leaf.addEventListener('ping', () => order.push('capture'), { capture: true });
		leaf.dispatchEvent(new Event('ping'));
		expect(order).toEqual(['bubble', 'capture']);
		root.destroy();
	});

	it('stopPropagation during capture prevents the target from seeing it', () => {
		const { root, top, leaf } = tree();
		const order: string[] = [];
		top.addEventListener(
			'ping',
			(event) => {
				order.push('top-capture');
				event.stopPropagation();
			},
			{ capture: true },
		);
		leaf.addEventListener('ping', () => order.push('leaf'));
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(order).toEqual(['top-capture']);
		root.destroy();
	});

	it('composedPath lists target -> ancestors during dispatch', () => {
		const { root, top, mid, leaf } = tree();
		let path: EventTarget[] = [];
		top.addEventListener('ping', (event) => {
			path = event.composedPath();
		});
		const event = new Event('ping', { bubbles: true });
		leaf.dispatchEvent(event);
		expect(path).toEqual([leaf, mid, top]);
		expect(event.composedPath()).toEqual([]);
		root.destroy();
	});
});

describe('listener registration semantics', () => {
	it('dedupes by (type, callback, capture)', () => {
		const { root, leaf } = tree();
		let count = 0;
		const listener = (): void => {
			count++;
		};
		leaf.addEventListener('ping', listener);
		leaf.addEventListener('ping', listener);
		leaf.addEventListener('ping', listener, { capture: true });
		leaf.dispatchEvent(new Event('ping'));
		// bubble registration once + capture registration once, both at target
		expect(count).toEqual(2);
		root.destroy();
	});

	it('removeEventListener respects the capture flag', () => {
		const { root, leaf } = tree();
		let count = 0;
		const listener = (): void => {
			count++;
		};
		leaf.addEventListener('ping', listener);
		leaf.removeEventListener('ping', listener, { capture: true }); // wrong flag
		leaf.dispatchEvent(new Event('ping'));
		expect(count).toEqual(1);
		leaf.removeEventListener('ping', listener);
		leaf.dispatchEvent(new Event('ping'));
		expect(count).toEqual(1);
		root.destroy();
	});

	it('once consumes the listener after one matching dispatch', () => {
		const { root, leaf } = tree();
		let count = 0;
		leaf.addEventListener('ping', () => count++, { once: true });
		leaf.dispatchEvent(new Event('ping'));
		leaf.dispatchEvent(new Event('ping'));
		expect(count).toEqual(1);
		root.destroy();
	});

	it('once is not consumed by a phase that does not match', () => {
		const { root, mid, leaf } = tree();
		let count = 0;
		// A bubble-once listener on mid; a non-bubbling dispatch at leaf walks mid
		// during capture only, which must not consume it.
		mid.addEventListener('ping', () => count++, { once: true });
		leaf.dispatchEvent(new Event('ping'));
		expect(count).toEqual(0);
		leaf.dispatchEvent(new Event('ping', { bubbles: true }));
		expect(count).toEqual(1);
		root.destroy();
	});

	it('an aborted signal removes the listener', () => {
		const { root, leaf } = tree();
		let count = 0;
		const controller = new AbortController();
		leaf.addEventListener('ping', () => count++, { signal: controller.signal });
		leaf.dispatchEvent(new Event('ping'));
		controller.abort();
		leaf.dispatchEvent(new Event('ping'));
		expect(count).toEqual(1);
		root.destroy();
	});

	it('supports handleEvent objects', () => {
		const { root, leaf } = tree();
		let count = 0;
		leaf.addEventListener('ping', {
			handleEvent: () => {
				count++;
			},
		});
		leaf.dispatchEvent(new Event('ping'));
		expect(count).toEqual(1);
		root.destroy();
	});
});

describe('event reuse', () => {
	it('an unstopped event can be dispatched again', () => {
		const { root, leaf } = tree();
		let count = 0;
		leaf.addEventListener('ping', () => count++);
		const event = new Event('ping', { bubbles: true });
		leaf.dispatchEvent(event);
		leaf.dispatchEvent(event);
		expect(count).toEqual(2);
		root.destroy();
	});

	it('a stopped event cannot be re-dispatched (native flag is sticky)', () => {
		const { root, leaf } = tree();
		leaf.addEventListener('ping', (event) => event.stopPropagation());
		const event = new Event('ping', { bubbles: true });
		leaf.dispatchEvent(event);
		expect(() => leaf.dispatchEvent(event)).toThrow(/fresh event/);
		root.destroy();
	});

	it('re-dispatching an in-flight event throws', () => {
		const { root, top, leaf } = tree();
		const event = new Event('ping', { bubbles: true });
		let threw = false;
		top.addEventListener('ping', () => {
			try {
				leaf.dispatchEvent(event);
			} catch {
				threw = true;
			}
		});
		leaf.dispatchEvent(event);
		expect(threw).toBe(true);
		root.destroy();
	});
});

describe('lifecycle events', () => {
	it('remove bubbles to ancestors before the node detaches', () => {
		const { root, top, mid, leaf } = tree();
		let sawTarget: unknown;
		let stillAttached = false;
		top.addEventListener('remove', (event) => {
			sawTarget = event.target;
			stillAttached = [...mid.children].includes(leaf);
		});
		leaf.remove();
		expect(sawTarget).toBe(leaf);
		expect(stillAttached).toBe(true);
		expect([...mid.children]).toEqual([]);
		root.destroy();
	});
});
