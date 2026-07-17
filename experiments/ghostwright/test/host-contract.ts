import { resolve } from "node:path";
import { expectTerminal, withTerminalAsync } from "../src/index.ts";
import { usePtyHostForTesting } from "../src/profile.ts";
import { SidecarClient } from "../src/pty/client.ts";

export async function runHostContract(hostPath: string): Promise<void> {
  const absolute = resolve(hostPath),
    restore = usePtyHostForTesting(absolute);
  try {
    await withTerminalAsync(
      {
        command: "/bin/sh",
        args: ["-c", `test -t 0 && test -t 1 && test -t 2 && printf 'TTY READY'`],
        trace: "off",
      },
      async (terminal) => {
        await expectTerminal(terminal.getByText("TTY READY")).toBePresent();
        const status = await terminal.process.waitForExit();
        if (status.exitCode !== 0 || !status.ptyEof)
          throw new Error(`invalid basic status: ${JSON.stringify(status)}`);
      },
    );

    await withTerminalAsync(
      {
        command: "/bin/sh",
        args: ["-c", `trap 'stty size; exit' WINCH; printf READY; while :; do sleep 1; done`],
        cleanup: { hangupGraceMs: 20, terminateGraceMs: 20, postExitDrainMs: 50 },
        trace: "off",
      },
      async (terminal) => {
        await expectTerminal(terminal.getByText("READY")).toBePresent();
        await terminal.resize({ columns: 43, rows: 12 });
        await expectTerminal(terminal.getByText("12 43")).toBePresent();
      },
    );

    await withTerminalAsync(
      {
        command: "/bin/sh",
        args: [
          "-c",
          `trap 'printf INTERRUPTED; exit 0' INT; printf SIGNAL_READY; while :; do sleep 1; done`,
        ],
        cleanup: { hangupGraceMs: 20, terminateGraceMs: 20, postExitDrainMs: 50 },
        trace: "off",
      },
      async (terminal) => {
        await expectTerminal(terminal.getByText("SIGNAL_READY")).toBePresent();
        await terminal.keyboard.press({ key: "c", control: true });
        await expectTerminal(terminal.getByText("INTERRUPTED")).toBePresent();
        if ((await terminal.process.waitForExit()).exitCode !== 0)
          throw new Error("canonical Control-C fixture failed");
      },
    );

    await withTerminalAsync(
      {
        command: process.execPath,
        args: [
          "-e",
          `process.stdin.setRawMode(true); process.stdout.write("RAW READY"); process.stdin.once("data", data => { process.stdout.write("\\r\\nRAW:" + data.toString("hex")); process.exit(0) })`,
        ],
        trace: "off",
      },
      async (terminal) => {
        await expectTerminal(terminal.getByText("RAW READY")).toBePresent();
        await terminal.keyboard.press({ key: "c", control: true });
        await expectTerminal(terminal.getByText("RAW:03")).toBePresent();
        if ((await terminal.process.waitForExit()).exitCode !== 0)
          throw new Error("raw input fixture failed");
      },
    );

    const started = performance.now();
    await withTerminalAsync(
      {
        command: "/bin/sh",
        args: ["-c", `node -e 'setInterval(()=>{}, 1000)' & printf FINAL; exit 0`],
        cleanup: { hangupGraceMs: 10, terminateGraceMs: 10, postExitDrainMs: 50 },
        trace: "off",
      },
      async (terminal) => {
        await expectTerminal(terminal.getByText("FINAL")).toBePresent();
        const status = await terminal.process.waitForExit({ timeoutMs: 1_000 });
        if (status.exitCode !== 0 || !status.ptyEof)
          throw new Error(`descendant drain failed: ${JSON.stringify(status)}`);
      },
    );
    if (performance.now() - started > 1_000)
      throw new Error("descendant cleanup exceeded deadline");

    const client = await SidecarClient.start(absolute, 1_000);
    try {
      let rejected = false;
      try {
        await client.write(new Uint8Array([1]));
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("host accepted WRITE before SPAWN");
    } finally {
      await client.close(1_000).catch(() => undefined);
    }
  } finally {
    restore();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: bun test/host-contract.ts <pty-host-path>");
  await runHostContract(path);
  console.log(`host contract passed: ${path}`);
}
