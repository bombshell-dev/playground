import { expectTerminal, withTerminalAsync } from '../dist/index.js';
import { GhostwrightError } from '../src/errors.ts';

await withTerminalAsync(
	{ command: '/bin/sh', args: ['-c', 'printf runtime-smoke'], trace: 'off' },
	async (terminal) => {
		await expectTerminal(terminal.getByText('runtime-smoke')).toBePresent();
		const status = await terminal.process.waitForExit();
		if (status.exitCode !== 0 || !status.ptyEof) {
			throw new GhostwrightError({
				code: 'GW_SMOKE_FAILED',
				message: `unexpected process status: ${JSON.stringify(status)}`,
			});
		}
	},
);
// oxlint-disable-next-line no-console -- test script
console.log('Ghostwright runtime smoke passed');
