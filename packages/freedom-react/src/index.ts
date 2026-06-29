// oxlint-disable bombshell-dev/no-generic-error
// oxlint-disable max-params
import ReactReconciler from 'react-reconciler';
import { DefaultEventPriority, LegacyRoot } from 'react-reconciler/constants.js';
import type { ReactNode } from 'react';
import type { CreateChildOptions, JsonValue, Node } from '@bomb.sh/freedom';

type Props = Record<string, unknown>;

// A host element with this type owns its freedom node but NOT its children:
// the reconciler refuses to reconcile them, leaving the subtree to a foreign
// driver (another framework adapter, or an imperative freedom decorator). Grab
// the node with a `ref` (getPublicInstance returns it) and drive it yourself.
const FOREIGN = 'foreign';

// react-reconciler builds instances detached (createInstance has no parent),
// then wires them bottom-up. freedom nodes must be born from a parent, so an
// Instance is a lightweight descriptor that holds the shape until its subtree
// attaches to a real node — at which point `realize` creates the nodes top-down.
interface Instance {
	type: string;
	props: Props;
	node: Node | null;
	kids: Child[];
}

interface TextInstance {
	text: string;
	node: Node | null;
}

type Child = Instance | TextInstance;

function isText(child: Child): child is TextInstance {
	return 'text' in child;
}

function realize(parent: Node, child: Child, before?: Node): void {
	const options: CreateChildOptions | undefined = before ? { before } : undefined;
	if (isText(child)) {
		const node = parent.createChild('#text', options);
		node.set('text', child.text);
		child.node = node;
		return;
	}
	const node = parent.createChild(child.type, options);
	child.node = node;
	apply(node, {}, child.props);
	if (child.type !== FOREIGN) {
		for (const kid of child.kids) {
			realize(node, kid);
		}
	}
}

function apply(node: Node, prev: Props, next: Props): void {
	for (const key of Object.keys(prev)) {
		if (key !== 'children' && !(key in next)) {
			node.unset(key);
		}
	}
	for (const [key, value] of Object.entries(next)) {
		if (key === 'children' || typeof value === 'function' || value === undefined) {
			continue;
		}
		if (prev[key] !== value) {
			node.set(key, value as JsonValue);
		}
	}
}

type Config = ReactReconciler.HostConfig<
	string, // Type
	Props, // Props
	Node, // Container
	Instance, // Instance
	TextInstance, // TextInstance
	never, // SuspenseInstance
	never, // HydratableInstance
	Node | null, // PublicInstance
	null, // HostContext
	true, // UpdatePayload
	never, // ChildSet
	ReturnType<typeof setTimeout>, // TimeoutHandle
	-1 // NoTimeout
>;

const config: Config = {
	supportsMutation: true,
	supportsPersistence: false,
	supportsHydration: false,
	isPrimaryRenderer: true,
	noTimeout: -1,
	scheduleTimeout: setTimeout,
	cancelTimeout: clearTimeout,

	createInstance(type, props) {
		return { type, props, node: null, kids: [] };
	},
	createTextInstance(text) {
		return { text, node: null };
	},
	appendInitialChild(parent, child) {
		parent.kids.push(child);
	},
	finalizeInitialChildren() {
		return false;
	},
	shouldSetTextContent() {
		return false;
	},
	prepareUpdate() {
		return true;
	},
	getRootHostContext() {
		return null;
	},
	getChildHostContext(parent) {
		return parent;
	},
	getPublicInstance(instance) {
		return instance.node;
	},
	prepareForCommit() {
		return null;
	},
	resetAfterCommit() {},
	preparePortalMount() {},
	getCurrentEventPriority() {
		return DefaultEventPriority;
	},
	getInstanceFromNode() {
		return null;
	},
	beforeActiveInstanceBlur() {},
	afterActiveInstanceBlur() {},
	prepareScopeUpdate() {},
	getInstanceFromScope() {
		return null;
	},
	detachDeletedInstance() {},

	appendChild(parent, child) {
		parent.kids.push(child);
		if (parent.node && parent.type !== FOREIGN && !child.node) {
			realize(parent.node, child);
		}
	},
	appendChildToContainer(container, child) {
		realize(container, child);
	},
	insertBefore(parent, child, before) {
		const at = parent.kids.indexOf(child);
		if (at >= 0) {
			parent.kids.splice(at, 1);
		}
		const mark = parent.kids.indexOf(before);
		parent.kids.splice(mark < 0 ? parent.kids.length : mark, 0, child);
		// Fresh insert positions correctly via createChild({ before }). Moving an
		// already-realized child is not yet supported (needs a same-parent reorder
		// op in freedom) — see the embedding notes.
		if (parent.node && parent.type !== FOREIGN && !child.node) {
			realize(parent.node, child, before.node ?? undefined);
		}
	},
	insertInContainerBefore(container, child, before) {
		if (!child.node) {
			realize(container, child, before.node ?? undefined);
		}
	},
	removeChild(parent, child) {
		const at = parent.kids.indexOf(child);
		if (at >= 0) {
			parent.kids.splice(at, 1);
		}
		void child.node?.remove();
		child.node = null;
	},
	removeChildFromContainer(_container, child) {
		void child.node?.remove();
		child.node = null;
	},
	resetTextContent() {},
	commitTextUpdate(textInstance, _old, text) {
		textInstance.node?.set('text', text);
	},
	commitUpdate(instance, _payload, _type, prev, next) {
		if (instance.node) {
			apply(instance.node, prev, next);
		}
	},
	hideInstance(instance) {
		instance.node?.set('hidden', true);
	},
	hideTextInstance() {},
	unhideInstance(instance) {
		instance.node?.unset('hidden');
	},
	unhideTextInstance() {},
	clearContainer(container) {
		for (const child of Array.from(container.children)) {
			void child.remove();
		}
	},
};

const reconciler = ReactReconciler(config);

export type Mount = ReturnType<typeof reconciler.createContainer>;

/**
 * Drive `node`'s children with a React element tree. Uses a legacy
 * (synchronous) root, so the freedom tree is fully built when `mount` returns.
 */
export function mount(element: ReactNode, node: Node): Mount {
	const container = reconciler.createContainer(
		node,
		LegacyRoot,
		null,
		false,
		null,
		'',
		(error) => {
			throw error;
		},
		null,
	);
	reconciler.updateContainer(element, container, null, null);
	return container;
}
