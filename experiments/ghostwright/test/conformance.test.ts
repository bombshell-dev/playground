import { expect, test } from 'bun:test';
import {
	expectTerminal,
	LaunchError,
	ReservedEnvironmentError,
	withTerminalAsync,
} from '../src/index.ts';

const node = process.execPath;

function evalArgs(source: string): string[] {
	return ['-e', source];
}

test('profile, TTY descriptors, geometry, styles, Unicode, and clipboard use Ghostty state', async () => {
	await withTerminalAsync(
		{
			command: node,
			args: evalArgs(`
        const fs = require("node:fs");
        process.stdout.write(
          JSON.stringify({ tty: [0,1,2].map(fd => fs.fstatSync(fd).isCharacterDevice()), size: [process.stdout.rows, process.stdout.columns], term: process.env.TERM }) + "\\r\\n" +
          "\\x1b[38;5;42m\\x1b[48;2;1;2;3mA\\x1b[0m文字e\\u0301" +
          "\\x1b]52;c;c2Vzc2lvbi1jbGlwYm9hcmQ=\\x07"
        );
      `),
			viewport: { columns: 60, rows: 8 },
			trace: 'off',
		},
		async (terminal) => {
			await terminal.process.waitForExit();
			const text = terminal.screen.getText();
			expect(text).toContain('"tty":[true,true,true]');
			expect(text).toContain('"size":[8,60]');
			expect(text).toContain('"term":"xterm-ghostty"');
			const styled = terminal.screen
				.current()
				.lines.flatMap((line) => line.cells)
				.find((cell) => cell.text === 'A')!;
			expect(styled.style.foreground).toEqual({ kind: 'palette', index: 42 });
			expect(styled.style.background).toEqual({ kind: 'rgb', red: 1, green: 2, blue: 3 });
			expect(terminal.screen.clipboard()).toBe('session-clipboard');
			const wideLine = terminal.screen
					.current()
					.lines.find((line) => line.cells.some((cell) => cell.text === '文'))!,
				wide = wideLine.cells.find((cell) => cell.text === '文');
			expect(wide?.width).toBe(2);
			expect(wideLine.cells[wide!.column + 1].continuation).toBe(true);
			const combining = terminal.screen
				.current()
				.lines.flatMap((line) => line.cells)
				.find((cell) => cell.text === 'é');
			expect(combining?.width).toBe(1);
		},
	);
});

test('Ghostty effects answer DA, size, color-scheme, ENQ, and XTVERSION queries', async () => {
	await withTerminalAsync(
		{
			command: node,
			args: evalArgs(`
        process.stdin.setRawMode(true);
        const chunks = [];
        let timer;
        process.stdin.on("data", chunk => {
          chunks.push(chunk);
          clearTimeout(timer);
          timer = setTimeout(() => {
            process.stdout.write("\\r\\nHEX:" + Buffer.concat(chunks).toString("hex"));
            process.exit(0);
          }, 20);
        });
        process.stdout.write("\\x05\\x1b[c\\x1b[>q\\x1b[18t\\x1b[?996n");
      `),
			viewport: { columns: 80, rows: 10 },
			trace: 'off',
		},
		async (terminal) => {
			await terminal.process.waitForExit({ timeoutMs: 2_000 });
			const text = terminal.screen.getText().replace(/\s/g, '');
			expect(text).toContain(Buffer.from('ghostwright').toString('hex'));
			expect(text).toContain(Buffer.from('\x1b[?62;22c').toString('hex'));
			expect(text).toContain(
				Buffer.from('ghostwright/0.1.0 libghostty-vt/f8041e849b36').toString('hex'),
			);
			expect(text).toContain(Buffer.from('\x1b[8;10;80t').toString('hex'));
			expect(text).toContain(Buffer.from('\x1b[?997;1n').toString('hex'));
		},
	);
});

test('mode-aware keyboard, paste, focus, mouse, and large raw input are acknowledged', async () => {
	await withTerminalAsync(
		{
			command: node,
			args: evalArgs(`
        process.stdin.setRawMode(true);
        process.stdout.write("\\x1b[?1h\\x1b[?1004h\\x1b[?1003h\\x1b[?1006h\\x1b[?2004hREADY");
        const chunks = [];
        let bytes = 0;
        process.stdin.on("data", chunk => {
          chunks.push(chunk); bytes += chunk.length;
          if (bytes >= 70033) {
            const data = Buffer.concat(chunks);
            process.stdout.write("\\r\\nPREFIX:" + data.subarray(0, 37).toString("hex") + " TOTAL:" + bytes);
            process.exit(0);
          }
        });
      `),
			viewport: { columns: 80, rows: 10 },
			trace: 'off',
		},
		async (terminal) => {
			await expectTerminal(terminal.getByText('READY')).toBePresent();
			const receipts = [
				await terminal.keyboard.press('ArrowUp'),
				await terminal.keyboard.focus('in'),
				await terminal.keyboard.paste('paste'),
				await terminal.mouse.move({ column: 2, row: 3 }),
				await terminal.keyboard.write(new Uint8Array(70_000)),
			];
			expect(receipts.every((receipt) => receipt.deliveredToChild)).toBe(true);
			expect(receipts.at(-1)?.bytesWritten).toBe(70_000);
			await terminal.process.waitForExit({ timeoutMs: 2_000 });
			const expectedPrefix = Buffer.from(
				'\x1bOA\x1b[I\x1b[200~paste\x1b[201~\x1b[<35;3;4M',
			).toString('hex');
			expect(terminal.screen.getText()).toContain(`PREFIX:${expectedPrefix}`);
			expect(terminal.screen.getText()).toContain('TOTAL:70033');
		},
	);
});

test('reserved profile environment and exec failures are typed', async () => {
	await expect(
		withTerminalAsync({ command: node, env: { TERM: 'bad' }, trace: 'off' }, async () => undefined),
	).rejects.toBeInstanceOf(ReservedEnvironmentError);
	await expect(
		withTerminalAsync({ command: '/definitely/missing', trace: 'off' }, async () => undefined),
	).rejects.toBeInstanceOf(LaunchError);
});

test('parallel sessions own isolated WASM and PTY state', async () => {
	const values = await Promise.all(
		Array.from({ length: 8 }, (_, index) =>
			withTerminalAsync(
				{
					command: node,
					args: evalArgs(`process.stdout.write("session-${index}")`),
					trace: 'off',
				},
				async (terminal) => {
					await terminal.process.waitForExit();
					return terminal.screen.getText();
				},
			),
		),
	);
	for (let index = 0; index < values.length; index++) {
		expect(values[index]).toContain(`session-${index}`);
		expect(values[index]).not.toContain(`session-${(index + 1) % values.length}`);
	}
});
