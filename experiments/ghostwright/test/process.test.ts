import { expect, test } from "bun:test";
import { expectTerminal, withTerminalAsync } from "../src/index.ts";

test("user Control-C travels through PTY line discipline", async () => {
  await withTerminalAsync(
    {
      command: "/bin/sh",
      args: [
        "-c",
        `trap 'printf INTERRUPTED; exit 0' INT; printf READY; while :; do sleep 1; done`,
      ],
      trace: "off",
    },
    async (terminal) => {
      await expectTerminal(terminal.getByText("READY")).toBePresent();
      await terminal.keyboard.press({ key: "c", control: true });
      await expectTerminal(terminal.getByText("INTERRUPTED")).toBePresent();
      expect((await terminal.process.waitForExit()).exitCode).toBe(0);
    },
  );
});

test("raw Control-C remains input while administrative signals target the OS process", async () => {
  await withTerminalAsync(
    {
      command: process.execPath,
      args: [
        "-e",
        `process.stdin.setRawMode(true); process.stdout.write("READY"); process.stdin.once("data", data => { process.stdout.write("\\r\\nRAW:" + data.toString("hex")); setInterval(()=>{}, 1000) }); process.on("SIGTERM", () => { process.stdout.write("\\r\\nTERM"); process.exit(0) })`,
      ],
      trace: "off",
    },
    async (terminal) => {
      await expectTerminal(terminal.getByText("READY")).toBePresent();
      await terminal.keyboard.press({ key: "c", control: true });
      await expectTerminal(terminal.getByText("RAW:03")).toBePresent();
      expect(terminal.process.status().state).toBe("running");
      await terminal.process.signal("SIGTERM", "child");
      await expectTerminal(terminal.getByText("TERM")).toBePresent();
      expect((await terminal.process.waitForExit()).exitCode).toBe(0);
    },
  );
});

test("natural direct-child exit drains and then owns a PTY-holding descendant", async () => {
  const started = performance.now();
  await withTerminalAsync(
    {
      command: "/bin/sh",
      args: ["-c", `node -e 'setInterval(()=>{}, 1000)' & child=$!; printf FINAL; exit 0`],
      cleanup: { hangupGraceMs: 10, terminateGraceMs: 10, postExitDrainMs: 50 },
      trace: "off",
    },
    async (terminal) => {
      await expectTerminal(terminal.getByText("FINAL")).toBePresent();
      const status = await terminal.process.waitForExit({ timeoutMs: 1_000 });
      expect(status.exitCode).toBe(0);
      expect(status.ptyEof).toBe(true);
    },
  );
  expect(performance.now() - started).toBeLessThan(1_000);
});
