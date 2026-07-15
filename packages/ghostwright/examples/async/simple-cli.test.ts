import { expect, test } from "bun:test";
import { expectTerminal, withTerminalAsync } from "../../src/index.ts";

const cli = {
  command: "/bin/sh",
  args: [
    "-c",
    `printf 'What is your name? '; IFS= read -r name; printf '\r\nHello, %s!\r\n' "$name"`,
  ],
  viewport: { columns: 40, rows: 6 },
  trace: "off" as const,
};

test("async API drives a portable interactive shell CLI", async () => {
  await withTerminalAsync(cli, async (terminal) => {
    await expectTerminal(terminal.getByText("What is your name?")).toBePresent();

    await terminal.keyboard.type("Ada");
    await terminal.keyboard.press("Enter");

    await expectTerminal(terminal.getByText("Hello, Ada!")).toBeStable();

    const status = await terminal.process.waitForExit();
    expect(status.exitCode).toBe(0);
    expect(status.ptyEof).toBe(true);
  });
});
