# Agent quickstart

This guide optimizes for one outcome: a coding agent can add a useful outside-in blackbox test for an existing CLI immediately.

## Hand Ghostwright to an agent

After installing the package, give your coding agent this instruction:

> Read `node_modules/ghostwright/AGENTS.md`. Add outside-in blackbox tests for `<command>`. Use the repository's existing test runner, visible terminal state only, no application instrumentation, and no fixed readiness sleeps. Run the focused tests and inspect Ghostwright artifacts before reporting failure.

Inside this monorepo, use:

> Read `packages/ghostwright/AGENTS.md`, then blackbox test `<target command>` using Ghostwright's public API.

## Install

```sh
npm install --save-dev ghostwright
# or
bun add --dev ghostwright
```

Supported runtimes and hosts:

- Node 22+
- Bun 1.2+
- Deno 2.2+
- macOS or Linux, arm64 or x64

Consumers use bundled artifacts and do not need a C compiler, Rust, Zig, or Ghostty.

## Identify the real command

Before writing assertions, determine:

- The direct executable
- Each argument as a separate string
- The cwd expected by the application
- Required nonreserved environment values
- Whether the process should exit or remain interactive

Good:

```ts
{
  command: "bun",
  args: ["src/cli.ts", "--mode", "test"],
}
```

Explicit shell when shell syntax is intentional:

```ts
{
  command: "/bin/sh",
  args: ["-c", "printf 'Ready'; exec my-cli"],
}
```

Do not combine an executable and arguments into an implicit shell string.

## First Bun test

```ts
import { expect, test } from 'bun:test';
import { expectTerminal, withTerminalAsync } from 'ghostwright';

test('CLI starts and accepts input', async () => {
	await withTerminalAsync(
		{
			command: 'bun',
			args: ['src/cli.ts'],
			cwd: process.cwd(),
			viewport: { columns: 80, rows: 24 },
		},
		async (terminal) => {
			await expectTerminal(terminal.getByText('Ready')).toBePresent();

			await terminal.keyboard.type('hello');
			await terminal.keyboard.press('Enter');

			await expectTerminal(terminal.getByText('Received: hello')).toBeStable();

			const status = await terminal.process.waitForExit();
			expect(status.exitCode).toBe(0);
			expect(status.ptyEof).toBe(true);
		},
	);
});
```

Run only that test while developing:

```sh
bun test test/cli.blackbox.test.ts
```

## Node test runner

Ghostwright assertions throw ordinary typed errors and require no runner plugin:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { expectTerminal, withTerminalAsync } from 'ghostwright';

test('CLI help', async () => {
	await withTerminalAsync(
		{ command: 'node', args: ['dist/cli.js', '--help'] },
		async (terminal) => {
			await expectTerminal(terminal.getByText('Usage:')).toBePresent();
			const status = await terminal.process.waitForExit();
			assert.equal(status.exitCode, 0);
		},
	);
});
```

## Deno permissions

Deno must read package artifacts, execute the selected PTY host, and inherit environment values:

```sh
deno test \
  --allow-read=node_modules/ghostwright \
  --allow-run=node_modules/ghostwright/artifacts/pty-host-<target> \
  --allow-env \
  test/cli.blackbox.test.ts
```

If permission is missing, Ghostwright reports the exact artifact and host paths to grant.

## Build useful coverage in this order

### 1. Launch and help

Verify the command launches under a real TTY, displays a visible marker, and exits as expected.

### 2. Interactive happy path

Wait for readiness, perform one keyboard or mouse interaction, and assert the final stable screen.

### 3. Transient progress

Save the action receipt, assert the fleeting progress state from history, then assert the final state:

```ts
const action = await terminal.keyboard.press('Enter');
await expectTerminal(terminal).toHaveShownText('Working', { since: action });
await expectTerminal(terminal.getByText('Done')).toBeStable();
```

### 4. Resize

```ts
await terminal.resize({ columns: 100, rows: 30 });
await expectTerminal(terminal.getByText('100x30')).toBeStable();
```

Ghostwright uses real PTY resize and `SIGWINCH`; it does not inject synthetic resize bytes.

### 5. Failure and cleanup

Trigger invalid input or cancellation, assert the visible error/process result, and rely on the scoped callback to clean up the process group.

## A real terminal confidence check

The vi examples prove Ghostwright is exercising raw input, alternate-screen restoration, terminfo, and process lifecycle rather than parsing a pipe:

- [`../examples/async/agent-closes-vi.test.ts`](../examples/async/agent-closes-vi.test.ts)
- [`../examples/async/bash-vi-roundtrip.test.ts`](../examples/async/bash-vi-roundtrip.test.ts)

The second example prints `hello world` in interactive Bash, enters vi's alternate screen, exits vi, and verifies Bash's primary screen still contains the original output.

## Next references

- Choose synchronization correctly: [`choosing-assertions.md`](choosing-assertions.md)
- Copy interaction patterns: [`interaction-recipes.md`](interaction-recipes.md)
- Diagnose failures: [`debugging-failures.md`](debugging-failures.md)
