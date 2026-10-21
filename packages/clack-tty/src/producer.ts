import type { UIExtensionContext, RenderFrame } from '@clack/ui/extensions';
import { encodeFrame, geometryFor, type ClackNode, type JsonScalar } from './protocol.ts';

/** Optional diagnostics for semantic frames that cannot be emitted. */
export interface SemanticOptions {
	onDiagnostic?(error: Error): void;
}

/** Emit descriptions from UI's immutable committed-frame data, never live app state. */
// oxlint-disable-next-line bombshell-dev/exported-function-async -- Extension observers install synchronously.
export function useSemantic(
	context: UIExtensionContext,
	options: SemanticOptions = {},
): () => void {
	let sequence = 0;
	return context.onRender(async (frame: RenderFrame) => {
		try {
			const surface = { columns: frame.width, rows: frame.height, row: 1 };
			const nodes: ClackNode[] = frame.elements.map((element) => {
				const { role, label, type } = element.attributes;
				const custom: [string, JsonScalar][] = Object.entries(element.attributes)
					.filter(([name]) => name.startsWith('data-'))
					.map(([name, value]) => [name.slice(5), value]);
				if (type !== undefined) custom.push(['type', type]);
				return {
					key: element.id,
					name: element.name,
					parent: element.parent,
					order: element.order,
					attrs: {
						...(role !== undefined ? { role } : {}),
						...(label !== undefined ? { label } : {}),
						...(element.name === 'input' ? { input: true } : {}),
						...(custom.length ? { custom: Object.fromEntries(custom) } : {}),
					},
					...(element.bounds ? { geo: geometryFor(element.bounds, surface) } : {}),
				};
			});
			const bytes = encodeFrame({ v: 1, frame: sequence + 1, surface, nodes });
			await context.write(bytes);
			sequence++;
		} catch (error) {
			options.onDiagnostic?.(error instanceof Error ? error : new TypeError(String(error)));
		}
	});
}
