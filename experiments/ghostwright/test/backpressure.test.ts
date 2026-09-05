import { expect, test } from 'bun:test';
import { withTerminalAsync, regionLocator, textContains } from '../src/index.ts';
import { SidecarClient } from '../src/pty/client.ts';
import { resolveAssets, normalizeViewport, profileEnvironment } from '../src/profile.ts';

test('a capture timeout cancels a blocked write without closing its parent session', async () => {
	const viewport = regionLocator({ column: 0, row: 0, width: 80, height: 24 });
	await withTerminalAsync(
		{
			command: process.execPath,
			args: [
				'-e',
				'process.stdin.setRawMode(true); process.stdout.write("READY"); setInterval(() => {}, 1000)',
			],
			trace: 'off',
		},
		async (t) => {
			await t.expect(viewport).toContainText('READY');
			await expect(
				t.capture(
					{ timeoutMs: 30, until: viewport.satisfies(textContains('NEVER')) },
					async (capture) => {
						await capture.keyboard.write(new Uint8Array(1024 * 1024));
					},
				),
			).rejects.toMatchObject({ code: 'GW_CAPTURE_TIMEOUT' });
			expect(t.process.status().state).toBe('running');
			await t.process.signal('SIGTERM');
			await t.process.waitForExit();
		},
	);
});

test('a child that does not read input cannot block administrative close', async () => {
	const assets = await resolveAssets({ command: process.execPath });
	const client = await SidecarClient.start(assets.host, 3000);
	try {
		const ready = new Promise<void>((resolve) => {
			let output = '';
			client.on('output', (bytes) => {
				output += Buffer.from(bytes).toString();
				if (output.includes('READY')) resolve();
			});
		});
		await client.spawn({
			command: process.execPath,
			args: [
				'-e',
				'process.stdin.setRawMode(true); process.stdout.write("READY"); setInterval(() => {}, 1000)',
			],
			cwd: process.cwd(),
			env: profileEnvironment(undefined, assets.terminfo),
			viewport: normalizeViewport(),
			cleanup: { hangupGraceMs: 10, terminateGraceMs: 10, postExitDrainMs: 20 },
		});
		await ready;
		// Exceed the kernel input capacity, not the host's bounded input budget.
		// Observe all rejections immediately while close overtakes blocked writes.
		const writes = Promise.allSettled(
			Array.from({ length: 32 }, () => client.write(new Uint8Array(65536))),
		);
		await client.close(3000);
		const outcomes = await writes;
		expect(outcomes.some((result) => result.status === 'rejected')).toBe(true);
		expect(
			outcomes
				.filter((result) => result.status === 'rejected')
				.every((result) => result.reason.code === 'GW_WRITE_INTERRUPTED'),
		).toBe(true);
	} finally {
		client.forceKill();
	}
});
