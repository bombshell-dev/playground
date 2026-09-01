import { createApi, createContext, type Node } from './core.ts';
import { getElement, type HostElement, type HostElementChild } from './elements.ts';
import { HostApi, type Host } from './host.ts';

export const FocusApi = createApi('focus', {
	setFocusable(node): void {
		FocusableContext.set(node, true);

		const host = getHost(node);
		const focus = getFocus(node);

		if (focus === host.root && FocusApi.methods.isFocusable(node)) {
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
	getFocusScope(node): Node {
		const state = FocusContext.expect(node);
		return state.scopes[state.scopes.length - 1]?.node ?? getHost(node).root;
	},
	isFocusable(node): boolean {
		if (!FocusableContext.hasOwn(node) || !FocusableContext.expect(node)) return false;
		const scope = FocusApi.methods.getFocusScope(node);
		return scope === getHost(node).root || contains(scope, node);
	},
	activateFocusScope(node): void {
		const state = FocusContext.expect(node);
		if (state.scopes.some((scope) => scope.node === node)) {
			throw new DuplicateFocusScopeError(node);
		}
		state.scopes.push({ node, restore: state.current });
		const first = focusableNodes(node)[0];
		if (!first) {
			state.scopes.pop();
			throw new EmptyFocusScopeError(node);
		}
		FocusApi.methods.setFocus(first);
	},
	deactivateFocusScope(node): void {
		const state = FocusContext.expect(node);
		const active = state.scopes[state.scopes.length - 1];
		if (!active || active.node !== node) {
			throw new FocusScopeOrderError(node);
		}
		state.scopes.pop();
		const host = getHost(node);
		const scope = FocusApi.methods.getFocusScope(node);
		const canRestore =
			contains(host.root, active.restore) && FocusApi.methods.isFocusable(active.restore);
		const replacement = canRestore
			? active.restore
			: (focusableNodes(scope)[0] ?? host.root);
		FocusApi.methods.setFocus(replacement);
	},
	advanceFocus(node): void {
		const current = getFocus(node);
		const candidates = focusableNodes(FocusApi.methods.getFocusScope(node));
		if (candidates.length === 0) return;
		const index = candidates.indexOf(current);
		setFocus(candidates[index < 0 ? 0 : (index + 1) % candidates.length]!);
	},
	retreatFocus(node): void {
		const current = getFocus(node);
		const candidates = focusableNodes(FocusApi.methods.getFocusScope(node));
		if (candidates.length === 0) return;
		const index = candidates.indexOf(current);
		setFocus(candidates[index <= 0 ? candidates.length - 1 : index - 1]!);
	},
});

export const {
	setFocusable,
	getFocus,
	setFocus,
	getFocusScope,
	isFocusable,
	activateFocusScope,
	deactivateFocusScope,
	advanceFocus,
	retreatFocus,
} = FocusApi.methods;

export function useFocus(host: Host): void {
	FocusContext.set(host.root, { current: host.root, scopes: [] });
	HostApi.around(host.root, {
		removeChild([root, parent, removed], next) {
			if (removed.type === 'element') {
				let scope = getFocusScope(root);
				while (scope !== root && contains(removed.node!, scope)) {
					deactivateFocusScope(scope);
					scope = getFocusScope(root);
				}

				if (contains(removed.node!, getFocus(root))) {
					const tail = lastElementOf(removed);
					const after = forward({ start: tail });
					const before = forward({
						start: host.element,
						limit: removed,
					});
					const replacement = findFocus(concat(after, before)) ?? host.root;
					setFocus(replacement);
				}
			}

			return next(root, parent, removed);
		},
	});
}

const { getHost } = HostApi.methods;

interface FocusState {
	current: Node;
	scopes: Array<{ node: Node; restore: Node }>;
}

const FocusContext = createContext<FocusState>('focus');
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

function* concat<A>(...iterables: Iterable<A>[]): Generator<A> {
	for (const iterable of iterables) {
		yield* iterable;
	}
}

function focusableNodes(scope: Node): Node[] {
	const nodes: Node[] = [];
	function visit(element: HostElement): void {
		if (element.node && FocusApi.methods.isFocusable(element.node)) nodes.push(element.node);
		for (const child of element.children) {
			if (child.type === 'element') visit(child);
		}
	}
	visit(getElement(scope));
	return nodes;
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

class DuplicateFocusScopeError extends TypeError {
	readonly code = 'CLACK_UI_DUPLICATE_FOCUS_SCOPE';
	constructor(readonly node: Node) {
		super('attempted to activate an active focus scope');
		this.name = 'DuplicateFocusScopeError';
	}
}

class EmptyFocusScopeError extends TypeError {
	readonly code = 'CLACK_UI_EMPTY_FOCUS_SCOPE';
	constructor(readonly node: Node) {
		super('focus scope has no focusable descendants');
		this.name = 'EmptyFocusScopeError';
	}
}

class FocusScopeOrderError extends TypeError {
	readonly code = 'CLACK_UI_FOCUS_SCOPE_ORDER';
	constructor(readonly node: Node) {
		super('focus scopes must be deactivated in stack order');
		this.name = 'FocusScopeOrderError';
	}
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
