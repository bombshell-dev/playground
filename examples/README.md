# Ghostwright API examples

Both example suites automate the same interactive CLI so the two public API styles can be compared directly:

- [`async/simple-cli.test.ts`](async/simple-cli.test.ts) uses `withTerminalAsync` and promises.
- [`effection/simple-cli.test.ts`](effection/simple-cli.test.ts) uses `withTerminal` and Effection operations.

The application under test is `/bin/sh`, which is present on every macOS and Linux host supported by Ghostwright. The shell is launched explicitly—Ghostwright never inserts an implicit shell. Its script uses only POSIX `printf` and `read` builtins, prompts for a name, and prints a greeting.

Run both examples with:

```sh
bun test packages/ghostwright/examples
```
