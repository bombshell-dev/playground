import { expect, test } from "bun:test";
import { run } from "effection";
import { expectTerminal, withTerminal } from "../../src/index.ts";

const cli = {
  command: "/bin/sh",
  args: [
    "-c",
    `printf 'What is your name? '; IFS= read -r name; printf '\r\nHello, %s!\r\n' "$name"`,
  ],
  viewport: { columns: 40, rows: 6 },
  trace: "off" as const,
};

test("Effection API drives a portable interactive shell CLI", async () => {
  await run(function* () {
    return yield* withTerminal(cli, function* (terminal) {
      yield* expectTerminal(terminal.getByText("What is your name?")).toBePresent();

      yield* terminal.keyboard.type("Grace");
      yield* terminal.keyboard.press("Enter");

      yield* expectTerminal(terminal.getByText("Hello, Grace!")).toBeStable();

      const status = yield* terminal.process.waitForExit();
      expect(status.exitCode).toBe(0);
      expect(status.ptyEof).toBe(true);
    });
  });
});
