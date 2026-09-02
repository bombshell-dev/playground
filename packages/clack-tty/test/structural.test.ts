import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const playgroundRoot = fileURLToPath(new URL('../../..', import.meta.url));
const uiClone = resolve(playgroundRoot, '../ui');

const git = (args: string[], cwd: string) =>
	spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim();

describe('vehicle and packaging (TC-P1, REQ-001/REQ-002, NFR-001)', () => {
	test('ghostwright artifacts are available in-tree', () => {
		expect(existsSync(`${playgroundRoot}/experiments/ghostwright/artifacts/ghostty-vt.wasm`)).toBe(true);
	});

	test('clack/ui resolves to the vendored workspace package', () => {
		const pkg = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8'));
		expect(pkg.dependencies['@clack/ui']).toBe('workspace:*');
		const link = spawnSync('node', ['-e', 'console.log(require.resolve("@clack/ui/package.json"))'], {
			cwd: packageRoot,
			encoding: 'utf8',
		});
		// The vendored package is source-first; resolving its directory is enough.
		const resolved = link.stdout.trim() || link.stderr;
		expect(resolved.length).toBeGreaterThan(0);
		expect(readFileSync(`${packageRoot}/../../vendor/clack-ui/package.json`, 'utf8')).toContain('"@clack/ui"');
	});

	test('render is an extensible API member; the onFrame hook is gone', () => {
		const renderSource = readFileSync(`${packageRoot}/../../vendor/clack-ui/src/render.ts`, 'utf8');
		expect(renderSource).toContain('render(_node');
		expect(renderSource).toContain('return result;');
		const uiSource = readFileSync(`${packageRoot}/../../vendor/clack-ui/src/ui.ts`, 'utf8');
		expect(uiSource.includes('onFrame')).toBe(false);
		const focusSource = readFileSync(`${packageRoot}/../../vendor/clack-ui/src/focus.ts`, 'utf8');
		expect(focusSource).toContain('isFocusable(node): boolean');
		expect(focusSource.includes('export const FocusableContext')).toBe(false);
	});

	test('the clack/ui repository clone carries no working-tree changes', () => {
		expect(git(['status', '--porcelain'], uiClone)).toBe('');
	});
});

describe('freedom experiment removal (TC-P2, REQ-003)', () => {
	test('packages/freedom-tty is gone and no OSC usages remain', () => {
		expect(existsSync(`${playgroundRoot}/packages/freedom-tty`)).toBe(false);
		const files = spawnSync(
			'node',
			[
				'-e',
				`const { execSync } = require('child_process');
				let out = '';
				try { out = execSync('grep -rEl --exclude-dir=node_modules --exclude-dir=test "encodeFreedomTtyFrame|FREEDOM_TTY_OSC|ghostwright.freedom-tty" packages examples scripts', { cwd: ${JSON.stringify(playgroundRoot)}, encoding: 'utf8' }); } catch {}
				console.log(out.trim());`,
			],
			{ encoding: 'utf8' },
		);
		expect(files.stdout.trim()).toBe('');
	});

});

describe('extension/application separation (Decision: husky-style activation)', () => {
	const demoRoot = resolve(packageRoot, '../hello-world');

	test('the demo application source imports nothing from the extension package', () => {
		const source = readFileSync(`${demoRoot}/src/hello-world.ts`, 'utf8');
		expect(source.includes('@ghostwright')).toBe(false);
		expect(source.includes('useSemantic')).toBe(false);
		expect(source).toContain("from '@clack/ui'");
	});

	test('the demo declares the extension in package.json, husky-style', () => {
		const pkg = JSON.parse(readFileSync(`${demoRoot}/package.json`, 'utf8'));
		expect(pkg['@clack/ui']?.extensions).toEqual(['@ghostwright/clack-tty/auto']);
		expect(pkg.dependencies['@ghostwright/clack-tty']).toBe('workspace:*');
		expect(pkg.dependencies['@clack/ui']).toBe('workspace:*');
	});

	test('the extension package itself declares no clack/ui extensions', () => {
		const pkg = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8'));
		expect(pkg['@clack/ui']).toBeUndefined();
	});
});

describe('bun-free test path (TC-P3, REQ-004)', () => {
	test('the package test script is vitest-only', () => {
		const pkg = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8'));
		expect(pkg.scripts.test).toBe('vitest run');
		const scripts = JSON.stringify(pkg.scripts);
		expect(scripts.includes('bun')).toBe(false);
	});
});
