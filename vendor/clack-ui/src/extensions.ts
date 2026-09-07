import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// oxlint-disable-next-line no-restricted-imports -- Walk filesystem parents from a caller-supplied directory.
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReadStream, WriteStream } from 'node:tty';
import type { Host } from './host.ts';

export interface UIExtensionContext {
	host: Host;
	input: ReadStream;
	output: WriteStream;
	width: number;
	height: number;
	inline: boolean;
}

export type UIExtension = (context: UIExtensionContext) => void;

class InvalidUIExtensionError extends TypeError {
	constructor(specifier: string) {
		super(`@clack/ui extension "${specifier}" must default-export a UIExtension function`);
		this.name = 'InvalidUIExtensionError';
	}
}

const REGISTRY = Symbol.for('@clack/ui/extensions');
const globals = globalThis as typeof globalThis & Record<symbol, unknown>;

/** Out-of-band registration: callable before clack/ui loads, cross-copy safe. */
export function registerUIExtension(extension: UIExtension): void {
	const registry = ((globals[REGISTRY] as UIExtension[] | undefined) ??= []);
	registry.push(extension);
}

export function registeredUIExtensions(): UIExtension[] {
	return ((globals[REGISTRY] as UIExtension[] | undefined) ?? []).slice();
}

function findPackageJson(from: string): string | undefined {
	let current = resolve(from);
	for (;;) {
		const candidate = join(current, 'package.json');
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * Load extensions declared in the nearest package.json:
 *
 *   "@clack/ui": { "extensions": ["some-extension-package"] }
 *
 * Each specifier resolves from the declaring package (so workspace and
 * installed dependencies both work) and must default-export a UIExtension.
 */
export async function loadDeclaredExtensions(from: string): Promise<UIExtension[]> {
	const pkgPath = findPackageJson(from);
	if (!pkgPath) return [];
	const declared = JSON.parse(readFileSync(pkgPath, 'utf8'))['@clack/ui']?.extensions;
	if (!Array.isArray(declared)) return [];
	const require = createRequire(pkgPath);
	return Promise.all(
		declared.map(async (specifier: string) => {
			const resolved = require.resolve(specifier);
			const module = await import(pathToFileURL(resolved).href);
			const extension = module.default;
			if (typeof extension !== 'function') {
				throw new InvalidUIExtensionError(specifier);
			}
			return extension as UIExtension;
		}),
	);
}
