# Ghostwright API examples

Both example suites automate the same interactive CLI so the two public API styles can be compared directly:

- [`async/simple-cli.test.ts`](async/simple-cli.test.ts) uses `withTerminalAsync` and promises.
- [`effection/simple-cli.test.ts`](effection/simple-cli.test.ts) uses `withTerminal` and Effection operations.
- [`async/agent-closes-vi.test.ts`](async/agent-closes-vi.test.ts) proves an async coding agent can exit vi.
- [`effection/agent-closes-vi.test.ts`](effection/agent-closes-vi.test.ts) proves the same thing with structured concurrency.
- [`async/bash-vi-roundtrip.test.ts`](async/bash-vi-roundtrip.test.ts) verifies Bash's primary screen survives a vi alternate-screen round trip.
- [`effection/bash-vi-roundtrip.test.ts`](effection/bash-vi-roundtrip.test.ts) runs the same screen-restoration check with Effection.

The vi examples use an isolated temporary HOME and a fixture marker, avoiding user configuration, welcome-screen, and locale assumptions. Linux CI installs `vim-tiny`; macOS uses its system vi.

The simple CLI application under test is `/bin/sh`, which is present on every macOS and Linux host supported by Ghostwright. The shell is launched explicitly—Ghostwright never inserts an implicit shell. Its script uses only POSIX `printf` and `read` builtins, prompts for a name, and prints a greeting.

Run all examples with:

```sh
bun test packages/ghostwright/examples
```
