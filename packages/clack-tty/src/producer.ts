/**
 * `useSemantic(host)` — the clack/ui producer plugin for the clack.ui semantic
 * tree protocol (REQ-010..REQ-014).
 *
 * The semantic node map is maintained incrementally through clack/ui host
 * middleware: elements join the map when they are attached (insertBefore),
 * leave it when they are detached (removeChild), and structural state is never
 * rebuilt by walking the host tree. Attribute values (`role`, `label`,
 * `data-*`) ride the ordinary property channel and are read from the element's
 * property bag at frame time; focus truth comes from clack/ui's focus API.
 *
 * Emission is opt-in and render-driven: `useSemantic` installs a render
 * observer via `RenderApi.around`. Each committed render emits exactly one
 * frame, written to the render chain's own output stream after that render's
 * payload bytes.
 */
import type { RenderInfo } from '@bomb.sh/tty';
import type { HostElement } from '@clack/ui/elements';
import { FocusApi } from '@clack/ui/focus';
import { HostApi, type Host } from '@clack/ui';
import { RenderApi } from '@clack/ui/render';
import { id } from '@clack/ui/core';
import {
	encodeFrame,
	geometryFor,
	LIMITS,
	type ClackFrameV1,
	type ClackNodeV1,
	type JsonScalar,
} from './protocol.ts';

export interface SemanticOptions {
	/** The render surface, in cells. `row` is 1-based and defaults to 1. */
	surface: { columns: number; rows: number; row?: number };
	/** Called instead of emitting when a frame cannot be produced. */
	onDiagnostic?(error: Error): void;
}

interface Entry {
	key: string;
	name: string;
	node: object;
	element: HostElement;
	parent: Entry | null;
	children: Entry[];
}

function collectAttached(element: HostElement, into: HostElement[]): void {
	for (const child of element.children) {
		if (child.type === 'element' && child.node) {
			into.push(child);
			collectAttached(child, into);
		}
	}
}

/** Sibling order among element children, read from the host's own child list. */
function siblingOrder(entry: Entry): number {
	const siblings = entry.element.parent?.children ?? [];
	let order = 0;
	for (const child of siblings) {
		if (child === entry.element) return order;
		if (child.type === 'element') order++;
	}
	return order;
}

export function useSemantic(host: Host, options: SemanticOptions): void {
	const entries = new Map<object, Entry>();

	function entryOf(element: HostElement): Entry | undefined {
		return element.node ? entries.get(element.node) : undefined;
	}

	function register(element: HostElement): void {
		if (!element.node || entries.has(element.node)) return;
		const entry: Entry = {
			key: id(element.node),
			name: element.name,
			node: element.node,
			element,
			parent: element.parent ? (entryOf(element.parent) ?? null) : null,
			children: [],
		};
		entries.set(element.node, entry);
		entry.parent?.children.push(entry);
		for (const child of element.children) {
			if (child.type === 'element') register(child);
		}
	}

	function unregister(element: HostElement): void {
		if (!element.node) return;
		const entry = entries.get(element.node);
		if (!entry) return;
		for (const child of element.children) {
			if (child.type === 'element') unregister(child);
		}
		if (entry.parent) {
			const index = entry.parent.children.indexOf(entry);
			if (index >= 0) entry.parent.children.splice(index, 1);
		}
		entries.delete(element.node);
	}

	// Adopt elements the application attached before the plugin installed.
	const attached: HostElement[] = [];
	collectAttached(host.element, attached);
	for (const element of attached) register(element);

	HostApi.around(host.root, {
		insertBefore([_node, _parent, child], next) {
			next(_node, _parent, child);
			if (child.type === 'element') register(child);
		},
		removeChild([_node, _parent, child], next) {
			next(_node, _parent, child);
			if (child.type === 'element') unregister(child);
		},
		// Structural hooks only: attribute values ride the element property bag,
		// which the host core keeps current. Registered so the middleware contract
		// (create/insert/remove/setProperty/setText) is complete in one place.
		setProperty([node, element, name, value], next) {
			next(node, element, name, value);
		},
		setText([node, text, content], next) {
			next(node, text, content);
		},
	});

	function focusStack(): string[] {
		const focus = FocusApi.methods.getFocus(host.root);
		return focus === host.root ? [] : [id(focus)];
	}

	function buildNodes(info: RenderInfo): ClackNodeV1[] {
		const focusNode = FocusApi.methods.getFocus(host.root);
		const nodes: ClackNodeV1[] = [];

		function visit(entry: Entry, parentKey: string | null, order: number): void {
			const focusable = FocusApi.methods.isFocusable(entry.node);
			const focused = entry.node === focusNode;
			const custom: Record<string, JsonScalar> = {};
			let role: string | undefined,
				label: string | undefined;
			for (const [name, value] of Object.entries(entry.element.properties)) {
				if (name === 'role' && typeof value === 'string') role = value;
				else if (name === 'label' && typeof value === 'string') label = value;
				else if (name.startsWith('data-') && value !== null && value !== undefined)
					custom[name.slice(5)] = value as JsonScalar;
			}
			const bounds = info.get(entry.key)?.bounds;
			const geo = bounds
				? geometryFor(
						{ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
						options.surface,
					)
				: undefined;
			nodes.push({
				key: entry.key,
				name: entry.name,
				parent: parentKey,
				order,
				attrs: {
					...(role !== undefined ? { role } : {}),
					...(label !== undefined ? { label } : {}),
					...(entry.name === 'input' ? { input: true } : {}),
					focusable,
					...(Object.keys(custom).length > 0 ? { custom } : {}),
				},
				states: { focused, focusRoot: focused },
				...(geo !== undefined ? { geo } : {}),
			});
			entry.children.forEach((child, index) => visit(child, entry.key, index));
		}

		for (const entry of entries.values()) {
			if (entry.parent === null) visit(entry, null, siblingOrder(entry));
		}
		return nodes;
	}

	let frameCounter = 0;

	function emit(info: RenderInfo, output: { write(chunk: Uint8Array): unknown }): void {
		try {
			const frame: ClackFrameV1 = {
				v: 1,
				frame: ++frameCounter,
				surface: {
					columns: options.surface.columns,
					rows: options.surface.rows,
					row: options.surface.row ?? 1,
				},
				focusStack: focusStack(),
				nodes: buildNodes(info),
			};
			if (frame.nodes.length > LIMITS.nodes) {
				options.onDiagnostic?.(
					new Error(`Semantic frame exceeds ${LIMITS.nodes} nodes; emission skipped`),
				);
				return;
			}
			output.write(encodeFrame(frame));
		} catch (error) {
			// A semantic failure is a diagnostic, never a broken paint.
			options.onDiagnostic?.(error as Error);
		}
	}

	// Render observer: `next` runs the remaining chain (strategy facade, core);
	// the core has written the payload bytes by the time it returns, so frames
	// always follow the payload bytes of their render.
	RenderApi.around(host.root, {
		render([_node, output, term, ops], next) {
			const result = next(_node, output, term, ops);
			if (result) emit(result.info, output);
			return result;
		},
	});
}
