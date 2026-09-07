import { expectTerminal, GhostwrightError, withTerminal } from '../dist/index.js';
import { launchTerminal } from '../dist/async.js';

await withTerminal(
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
// Import acquisition through a different entry point to verify shared runtime identity.
const terminal = await launchTerminal({
	command: '/bin/sh',
	args: ['-c', 'printf owned-smoke'],
	trace: 'off',
});
try {
	await expectTerminal(terminal).toSatisfy((screen) =>
		screen.lines[0].text.includes('owned-smoke'),
	);
	const found = await terminal.screen.findByText('owned-smoke');
	if (found.text() !== 'owned-smoke' || (await terminal.waitFor(() => false)) !== false)
		throw new GhostwrightError({
			code: 'GW_RUNTIME_SMOKE',
			message: 'Owned terminal query/wait contract failed',
		});
} finally {
	await terminal[Symbol.asyncDispose]();
}
console.info('Ghostwright runtime smoke passed');
