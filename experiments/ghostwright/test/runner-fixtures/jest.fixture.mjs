import { expect, test } from '@jest/globals';
// oxlint-disable-next-line import/no-unassigned-import -- Register Jest's terminal matchers.
import 'ghostwright/jest';
import { withTerminal, regionLocator } from 'ghostwright';

test('real Jest assertions inspect terminal evidence', async () => {
	await withTerminal(
		{ command: process.execPath, args: ['-e', 'process.stdout.write("hello Ryan")'], trace: 'off' },
		async ({ screen }) => {
			const greeting = await screen.findByText('hello Ryan');
			expect(greeting).toBeVisible();
			expect(greeting).toContainText('Ryan');
			expect(greeting).not.toContainText('Ada');
			expect(screen.queryByText('missing')).not.toBeVisible();
			expect(
				screen.getBy(regionLocator({ column: 200, row: 0, width: 1, height: 1 })),
			).not.toBeVisible();
		},
	);
});

if (process.env.GHOSTWRIGHT_NEGATIVE) {
	test('failure artifacts follow the callback outcome', async () => {
		await withTerminal(
			{
				command: process.execPath,
				args: ['-e', 'process.stdout.write("actual terminal text")'],
				trace: { policy: 'retain-on-failure', directory: process.env.GHOSTWRIGHT_TRACES },
			},
			async ({ screen }) => {
				expect(await screen.findByText('actual terminal text')).toContainText(
					'expected terminal text',
				);
			},
		);
	});
}
