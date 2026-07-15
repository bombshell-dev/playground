import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "effection";
import { expectTerminal, withTerminal } from "../../src/index.ts";

test("a coding agent can successfully close vi with Effection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ghostwright-vi-")),
    fixture = join(directory, "agent-test.txt");
  await writeFile(fixture, "GHOSTWRIGHT_VI_MARKER\n");

  try {
    await run(function* () {
      return yield* withTerminal(
        {
          command: "vi",
          args: [fixture],
          env: { HOME: directory, EXINIT: "", VIMINIT: "" },
          viewport: { columns: 80, rows: 24 },
          trace: "off",
        },
        function* (terminal) {
          yield* expectTerminal(terminal.getByText("GHOSTWRIGHT_VI_MARKER")).toBePresent({
            timeoutMs: 5_000,
          });

          yield* terminal.keyboard.press("Escape");
          yield* terminal.keyboard.type(":q!");
          yield* terminal.keyboard.press("Enter");

          const status = yield* terminal.process.waitForExit({ timeoutMs: 5_000 });
          expect(status.exitCode).toBe(0);
          expect(status.ptyEof).toBe(true);
        },
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
