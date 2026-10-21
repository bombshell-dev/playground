import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-unassigned-import -- Install terminal evidence matchers.
import '@ghostwright/clack-tty/vitest';
import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { createUI } from '@clack/ui';
import { createRoot } from '@clack/ui-preact';
import { clackTtyExtension, locator } from '@ghostwright/clack-tty';
import { useSemantic } from '@ghostwright/clack-tty/producer';
import { createTerminal } from '../../../experiments/ghostwright/spikes/in-process.ts';
import { recordTest } from '../../../experiments/ghostwright/spikes/recording-vitest.ts';

function Counter({ label }: { label: string }): VNode {
	const [count, setCount] = useState(0);
	return (
		<button
			label={label}
			type="button"
			onClick={() => setCount(count + 1)}
			style={{
				width: '24px',
				height: '3px',
				borderStyle: 'solid',
				borderColor: '#00cdcd',
				paddingLeft: '1px',
			}}
		>
			Count: {count}
		</button>
	);
}

for (const count of [1, 2]) {
	test(`records ${count} isolated counter components`, async (context) => {
		const recording = recordTest(context);
		await using terminal = await createTerminal({
			viewport: { columns: 42, rows: 12 },
			extensions: [clackTtyExtension(), recording],
		});
		await using ui = await createUI({ ...terminal.appIO, extensions: [useSemantic] });
		using root = createRoot(ui.document.documentElement);
		using _capture = recording;
		root.render(
			<div style={{ flexDirection: 'column', gap: '1px', paddingTop: '1px', paddingLeft: '2px' }}>
				<span style={{ color: '#00cdcd' }}>Ghostwright component recording</span>
				<Counter label="first" />
				{count === 2 ? <Counter label="second" /> : null}
			</div>,
		);
		terminal.run(ui.main);
		const first = locator('button[label="first"]');
		const second = locator('button[label="second"]');
		await terminal.waitFor(() =>
			expect(terminal.screen.getBy(first)).toHaveButtonFocus('Count: 0'),
		);
		await terminal.keyboard.press('Enter');
		await terminal.waitFor(() => expect(terminal.screen.getBy(first)).toContainText('Count: 1'));
		await terminal.keyboard.press('Enter');
		await terminal.waitFor(() => expect(terminal.screen.getBy(first)).toContainText('Count: 2'));
		if (count === 2) {
			await terminal.keyboard.press('Tab');
			await terminal.waitFor(() =>
				expect(terminal.screen.getBy(second)).toHaveButtonFocus('Count: 0'),
			);
			await terminal.keyboard.press('Enter');
			await terminal.waitFor(() => {
				expect(terminal.screen.getBy(second)).toContainText('Count: 1');
				expect(terminal.screen.getBy(first)).toContainText('Count: 2');
			});
		}
	});
}
