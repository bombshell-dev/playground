import { inspectFocus, type Node } from '@bomb.sh/freedom';
import type { RenderInfo } from '@bomb.sh/tty';

/** Experimental protocol number; not a proposed permanent OSC allocation. */
export const INSPECTOR_OSC = 7777,
	INSPECTOR_NAMESPACE = 'ghostwright.freedom-tty',
	INSPECTOR_VERSION = 1;

export interface FreedomTtyNodeMetadata {
	key: string;
	name: string;
	parent: string | null;
	order: number;
	rect?: [x: number, y: number, width: number, height: number];
	attributes: {
		role?: string;
		label?: string;
		input?: boolean;
		focusable: boolean;
	};
	states: {
		focused: boolean;
		focusRoot: boolean;
	};
}

export interface FreedomTtyFrameMetadata {
	version: number;
	frame: number;
	focusStack: string[];
	nodes: FreedomTtyNodeMetadata[];
}

function safeString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Join Freedom's semantic tree and focus state to tty/Clay's computed geometry.
 *
 * Application values are deliberately excluded. In particular, `value` and
 * `caret` are never serialized; input contents may contain passwords, card
 * numbers, tokens, or other data that must not leak into traces.
 */
export function inspectFreedomTty(options: {
	root: Node;
	info: RenderInfo;
	frame: number;
}): FreedomTtyFrameMetadata {
	const { root, info, frame } = options,
		focus = inspectFocus(root),
		nodes: FreedomTtyNodeMetadata[] = [];

	function visit(node: Node, position: { parent: Node | undefined; order: number }): void {
		const { parent, order } = position,
			element = info.get(node.id),
			props = node.props;
		nodes.push({
			key: node.id,
			name: node.name,
			parent: parent?.id ?? null,
			order,
			...(element
				? {
						rect: [
							element.bounds.x,
							element.bounds.y,
							element.bounds.width,
							element.bounds.height,
						] as [number, number, number, number],
					}
				: {}),
			attributes: {
				role: safeString(props.role),
				label: safeString(props.label),
				input: props.input === true ? true : undefined,
				focusable: 'focused' in props,
			},
			states: {
				focused: focus.focused?.id === node.id,
				focusRoot: focus.activeRoot.id === node.id,
			},
		});
		let childOrder = 0;
		for (const child of node.children) visit(child, { parent: node, order: childOrder++ });
	}

	visit(root, { parent: undefined, order: 0 });
	return {
		version: INSPECTOR_VERSION,
		frame,
		focusStack: focus.stack.map((entry) => entry.root.id),
		nodes,
	};
}

/** Encode one complete semantic frame as an invisible, namespaced OSC. */
export function encodeFreedomTtyFrame(frame: FreedomTtyFrameMetadata): Uint8Array {
	const payload = Buffer.from(JSON.stringify(frame)).toString('base64url');
	return Buffer.from(
		`\u001b]${INSPECTOR_OSC};${INSPECTOR_NAMESPACE};v=${INSPECTOR_VERSION};${payload}\u001b\\`,
	);
}
