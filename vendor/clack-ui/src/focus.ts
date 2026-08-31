import { createApi, createContext, type Node } from './core.ts';
import { getElement, type HostElement, type HostElementChild } from './elements.ts';
import { HostApi, type Host } from './host.ts';

export const FocusApi = createApi('focus', {
	setFocusable(node): void {
		FocusableContext.set(node, true);

		const host = getHost(node);
		const focus = getFocus(node);

		if (focus === host.root) {
			FocusContext.expect(node).current = node;
		}
	},
	setFocus(node): void {
		if (!FocusApi.methods.isFocusable(node) && node !== getHost(node).root) {
			throw new UnfocusableElementError(node);
		}
		FocusContext.expect(node).current = node;
	},
	getFocus(node): Node {
		return FocusContext.expect(node).current;
	},
	isFocusable(node): boolean {
		return FocusableContext.hasOwn(node) && FocusableContext.expect(node);
	},

	advanceFocus(node): void {
		const current = getFocus(node);
		const element = getElement(current);
		const host = getHost(node);

		const downward = forward({ start: element });
		const fromTop = forward({ start: host.element, limit: element });

		const next = findFocus(concat(downward, fromTop));

		if (next) {
			setFocus(next);
		}
	},

	retreatFocus(node): void {
		const current = getFocus(node);
		const element = getElement(current);
		const host = getHost(node);

		const upward = reverse({ start: element });

		const fromBottom = reverse({
			start: host.element,
			limit: element,
		});

		const previous = findFocus(concat(upward, fromBottom));

		if (previous) {
			setFocus(previous);
		}
	},
});

export const { setFocusable, getFocus, setFocus, isFocusable, advanceFocus, retreatFocus } = FocusApi.methods;

export function useFocus(host: Host): void {
	FocusContext.set(host.root, { current: host.root });
	HostApi.around(host.root, {
		removeChild([root, parent, removed], next) {
			if (removed.type === 'element' && contains(removed.node!, getFocus(root))) {
				const tail = lastElementOf(removed);

				const after = forward({ start: tail });
				const before = forward({
					start: host.element,
					limit: removed,
				});

				const replacement = findFocus(concat(after, before)) ?? host.root;

				setFocus(replacement);
			}

			return next(root, parent, removed);
		},
	});
}

const { getHost } = HostApi.methods;

const FocusContext = createContext<{ current: Node }>('focus');
const FocusableContext = createContext<boolean>('focusable', false);


interface Range {
	start: HostElementChild;
	limit?: HostElement;
}

function* forward(range: Range): Iterable<HostElement> {
	type Tier = {
		siblings: HostElementChild[];
		index: number;
	};
	const tiers: Tier[] = [
		{
			siblings: range.start.type === 'element' ? range.start.children : [],
			index: 0,
		},
	];

	let current = range.start;
	while (current.parent) {
		const siblings = current.parent.children;
		tiers.unshift({ siblings, index: siblings.indexOf(current) + 1 });
		current = current.parent;
	}

	while (tiers.length > 0) {
		const tier = tiers[tiers.length - 1]!;
		const child = tier.siblings[tier.index++];
		if (!child) {
			tiers.pop();
			continue;
		}
		if (child === range.limit) {
			break;
		}
		if (child.type === 'element') {
			if (child !== range.start) {
				yield child;
			}
			tiers.push({ siblings: child.children, index: 0 });
		}
	}
}

function* reverse(range: Range): Iterable<HostElement> {
	interface Tier {
		siblings: HostElementChild[];
		index: number;
		owner?: HostElement;
	}

	const tiers: Tier[] = [];

	if (!range.start.parent) {
		// host.element acts as the position after the entire tree.
		if (range.start.type === 'element') {
			tiers.push({
				siblings: range.start.children,
				index: range.start.children.length - 1,
			});
		}
	} else {
		let current = range.start;

		while (current.parent) {
			const parent = current.parent;
			const siblings = parent.children;

			tiers.unshift({
				siblings,
				index: siblings.indexOf(current) - 1,
				// Yield the parent after its preceding children, except for host.element.
				owner: parent.parent ? parent : undefined,
			});

			current = parent;
		}
	}

	while (tiers.length > 0) {
		const tier = tiers[tiers.length - 1]!;

		if (tier.index < 0) {
			tiers.pop();

			if (tier.owner) {
				if (tier.owner === range.limit) {
					break;
				}

				yield tier.owner;
			}

			continue;
		}

		const child = tier.siblings[tier.index--];

		if (child?.type === 'element') {
			tiers.push({
				siblings: child.children,
				index: child.children.length - 1,
				owner: child,
			});
		}
	}
}

function* concat<A>(...iterables: Iterable<A>[]): Generator<A> {
	for (const iterable of iterables) {
		yield* iterable;
	}
}

function findFocus(elements: Iterable<HostElement>): Node | undefined {
	for (const element of elements) {
		if (FocusApi.methods.isFocusable(element.node!)) {
			return element.node!;
		}
	}
}

function lastElementOf(element: HostElement): HostElement {
	const { children } = element;
	let last: HostElement | undefined = void 0;
	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i];
		if (child && child.type === 'element') {
			last = child;
			break;
		}
	}
	return last ? lastElementOf(last) : element;
}

function contains(node: Node, descendant: Node): boolean {
	if (node === descendant) {
		return true;
	} else {
		for (const child of node.children) {
			if (contains(child, descendant)) {
				return true;
			}
		}
	}
	return false;
}

class UnfocusableElementError extends TypeError {
	readonly code = 'CLACK_UI_UNFOCUSABLE_ELEMENT';
	readonly node: Node;

	constructor(node: Node) {
		super('attempted to focus an unfocusable element');
		this.name = 'UnfocusableElementError';
		this.node = node;
	}
}
