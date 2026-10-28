/* oxlint-disable bombshell-dev/max-params -- createPortal intentionally matches React’s public signature. */
/* oxlint-disable bombshell-dev/exported-function-async -- Framework mounting and host factories are synchronous by contract. */
import { createContext, type ReactNode } from 'react';
import Reconciler, { type HostConfig } from 'react-reconciler';
import {
	ConcurrentRoot,
	DefaultEventPriority,
	NoEventPriority,
} from 'react-reconciler/constants.js';
import type { Element, Text, Node, Document } from '@bomb.sh/dom';
import { updateHostProperties } from './properties.ts';

type Props = Readonly<Record<string, unknown>>;
type Config = HostConfig<
	string,
	Props,
	Element,
	Element,
	Text,
	never,
	never,
	never,
	never,
	Node,
	Document,
	never,
	ReturnType<typeof setTimeout>,
	-1,
	null,
	null,
	null,
	never,
	never,
	never
>;

let priority = NoEventPriority;
const nothing = (): void => {};
class UnsupportedHostOperationError extends Error {
	override name = 'UnsupportedHostOperationError';
}
const unsupported = (): never => {
	throw new UnsupportedHostOperationError('This React host operation is not supported');
};

const configuration: Config = {
	rendererVersion: '0.0.0',
	rendererPackageName: '@bomb.sh/dom',
	extraDevToolsConfig: null,
	bindToConsole: (_method, args: unknown[]) => () => console.info(...args),
	supportsMutation: true,
	supportsPersistence: false,
	supportsHydration: false,
	supportsMicrotasks: true,
	isPrimaryRenderer: true,
	getRootHostContext: (container) => container.ownerDocument,
	getChildHostContext: (context) => context,
	getPublicInstance: (instance) => instance,
	createInstance(type, props, container) {
		const element = container.ownerDocument.createElement(type);
		updateHostProperties(element, {}, props);
		return element;
	},
	createTextInstance: (value, container) => container.ownerDocument.createTextNode(value),
	appendInitialChild: (parent, child) => {
		parent.appendChild(child);
	},
	finalizeInitialChildren: () => false,
	shouldSetTextContent: () => false,
	prepareForCommit: () => null,
	resetAfterCommit: nothing,
	preparePortalMount: nothing,
	appendChild: (parent, child) => {
		parent.appendChild(child);
	},
	appendChildToContainer: (parent, child) => {
		parent.appendChild(child);
	},
	insertBefore: (parent, child, anchor) => {
		parent.insertBefore(child, anchor);
	},
	insertInContainerBefore: (parent, child, anchor) => {
		parent.insertBefore(child, anchor);
	},
	removeChild: (parent, child) => {
		parent.removeChild(child);
	},
	removeChildFromContainer: (parent, child) => {
		parent.removeChild(child);
	},
	clearContainer: (container) => {
		container.textContent = '';
	},
	resetTextContent: (element) => {
		element.textContent = '';
	},
	commitTextUpdate: (text, _previous, next) => {
		text.data = next;
	},
	commitUpdate: (element, _type, previous, next) => updateHostProperties(element, previous, next),
	scheduleTimeout: (callback, delay) => setTimeout(callback, delay),
	cancelTimeout: clearTimeout,
	noTimeout: -1,
	scheduleMicrotask: queueMicrotask,
	getInstanceFromNode: () => null,
	beforeActiveInstanceBlur: nothing,
	afterActiveInstanceBlur: nothing,
	prepareScopeUpdate: unsupported,
	getInstanceFromScope: () => null,
	detachDeletedInstance: nothing,
	NotPendingTransition: null,
	HostTransitionContext: createContext(null),
	setCurrentUpdatePriority: (value) => {
		priority = value;
	},
	getCurrentUpdatePriority: () => priority,
	resolveUpdatePriority: () => priority || DefaultEventPriority,
	resetFormInstance: unsupported,
	requestPostPaintCallback: (callback) => queueMicrotask(() => callback(performance.now())),
	shouldAttemptEagerTransition: () => false,
	trackSchedulerEvent: nothing,
	resolveEventType: () => null,
	resolveEventTimeStamp: () => performance.now(),
	maySuspendCommit: () => false,
	maySuspendCommitOnUpdate: () => false,
	maySuspendCommitInSyncRender: () => false,
	preloadInstance: () => true,
	startSuspendingCommit: () => null,
	suspendInstance: unsupported,
	suspendOnActiveViewTransition: unsupported,
	waitForCommitToBeReady: () => null,
	getSuspendedCommitReason: () => null,
	hideInstance: unsupported,
	hideTextInstance: unsupported,
	unhideInstance: unsupported,
	unhideTextInstance: unsupported,
};

const renderer = Reconciler(configuration);

export interface Root extends Disposable {
	readonly element: Element;
	/** Resolve when React commits the render. */
	render(children: ReactNode): Promise<void>;
	unmount(): void;
}

/** Official React reconciler targeting this package's native nodes and events. */
export function createRoot(element: Element): Root {
	const pending = new Set<(error: unknown) => void>();
	const onUncaughtError = (error: unknown): void => {
		if (!pending.size) element.ownerDocument.reportError(error);
		for (const reject of pending) reject(error);
		pending.clear();
	};
	const root = renderer.createContainer(
		element,
		ConcurrentRoot,
		null,
		false,
		null,
		'',
		onUncaughtError,
		nothing,
		(error: unknown) => element.ownerDocument.reportError(error),
		nothing,
		null,
	);
	return {
		element,
		render(children) {
			return new Promise((resolve, reject) => {
				pending.add(reject);
				renderer.updateContainer(children, root, null, () => {
					// React can report an uncaught render error later in this commit.
					queueMicrotask(() => {
						pending.delete(reject);
						resolve();
					});
				});
			});
		},
		unmount() {
			renderer.updateContainerSync(null, root, null, null);
			renderer.flushSyncWork();
			renderer.flushPassiveEffects();
		},
		[Symbol.dispose]() {
			this.unmount();
		},
	};
}

/** Create a portal owned by the destination container’s document. */
export function createPortal(children: ReactNode, container: Element, key?: string): ReactNode {
	return renderer.createPortal(children, container, null, key);
}
