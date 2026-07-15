import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import {
  HistoryChangedError,
  TerminalAssertionError,
  expectTerminal,
  withTerminalAsync,
} from "../src/index.ts";

const node = process.execPath;

test("retained ranges use exclusive baselines and bounded live collection", async () => {
  await withTerminalAsync(
    {
      command: node,
      args: [
        "-e",
        `let i = 0; const t = setInterval(() => { process.stdout.write("\\rREV-" + i++); if (i === 4) { clearInterval(t); setTimeout(() => process.exit(0), 20); } }, 20)`,
      ],
      trace: "off",
    },
    async (terminal) => {
      const collection = await terminal.revisions.collect({
        since: 0,
        until: (snapshot) => snapshot.lines.some((line) => line.text.includes("REV-3")),
        timeoutMs: 2_000,
      });
      expect(collection.revisions.length).toBeGreaterThan(0);
      expect(collection.revisions.every((revision) => revision.sequence > 0)).toBe(true);
      expect(collection.revisions.at(-1)?.snapshot.lines[0].text).toContain("REV-3");
      expect(terminal.screen.revisions({ since: 0, until: collection.revisions.at(-1)! })).toEqual(
        collection.revisions,
      );
      await terminal.process.waitForExit();
    },
  );
});

test("history is immutable, paginated, searchable, and generation guarded", async () => {
  await withTerminalAsync(
    {
      command: node,
      args: ["-e", `for (let i = 0; i < 30; i++) console.log("HISTORY-" + i)`],
      viewport: { columns: 30, rows: 5 },
      trace: "off",
    },
    async (terminal) => {
      await terminal.process.waitForExit();
      const oldest = await terminal.history.read({ count: 3 });
      expect(oldest.totalRows).toBeGreaterThan(20);
      expect(oldest.lines.map((line) => line.text.trim())).toEqual([
        "HISTORY-0",
        "HISTORY-1",
        "HISTORY-2",
      ]);
      const newest = await terminal.history.read({ start: 0, count: 3, direction: "newest-first" });
      expect(newest.lines.map((line) => line.index)).toEqual([2, 1, 0]);
      const matches = await terminal.history.findText("HISTORY-2", { limit: 20 });
      expect(matches.some((match) => match.line.text.trim() === "HISTORY-2")).toBe(true);
      await expect(
        terminal.history.read({ count: 1, expectedGeneration: "stale" }),
      ).rejects.toBeInstanceOf(HistoryChangedError);
    },
  );
});

test("history page boundaries retain soft-wrap continuation metadata", async () => {
  await withTerminalAsync(
    {
      command: node,
      args: [
        "-e",
        `process.stdout.write("abcdefghij\\n"); for (let i = 0; i < 20; i++) console.log("ROW-" + i)`,
      ],
      viewport: { columns: 5, rows: 4 },
      trace: "off",
    },
    async (terminal) => {
      await terminal.process.waitForExit();
      const all = await terminal.history.read({ count: 100 });
      const continuation = all.lines.find((line) => line.wrapContinuation)!;
      expect(continuation).toBeTruthy();
      const page = await terminal.history.read({ start: continuation.index, count: 1 });
      expect(page.lines[0].wrapContinuation).toBe(true);
    },
  );
});

test("raw Kitty graphics expose renderer-ready copied placement metadata", async () => {
  const pixels = new Uint8Array([
    255,
    0,
    0,
    255, // red
    0,
    255,
    0,
    255, // green
    0,
    0,
    255,
    255, // blue
    0,
    0,
    0,
    0, // transparent
  ]);
  const payload = Buffer.from(pixels).toString("base64");
  await withTerminalAsync(
    {
      command: node,
      args: [
        "-e",
        // `a=t` stores without creating the implicit default placement.
        `process.stdout.write("\\x1b_Ga=t,f=32,s=2,v=2,i=42;${payload}\\x1b\\\\\\x1b_Ga=p,i=42,p=7,c=4,r=4,z=-1;\\x1b\\\\\\x1b_Ga=p,i=42,p=8,c=4,r=4,z=-2;\\x1b\\\\\\x1b_Ga=p,i=42,p=9,c=4,r=4,z=-1073741825;\\x1b\\\\"); setTimeout(() => process.exit(0), 100)`,
      ],
      trace: "off",
    },
    async (terminal) => {
      await terminal.process.waitForExit();
      const graphics = terminal.screen.current().graphics;
      expect(graphics.supported).toBe(true);
      const placement = graphics.placements.find((candidate) => candidate.placementId === 7)!;
      expect(placement).toMatchObject({
        imageId: 42,
        virtual: false,
        z: -1,
        layer: "below-text",
        requestedGrid: { columns: 4, rows: 4 },
        renderedPixels: { width: 40, height: 80 },
        viewport: { column: 0, row: 0, visible: true },
      });
      expect(placement.image).toMatchObject({
        width: 2,
        height: 2,
        format: "rgba",
        compression: "none",
        dataLength: 16,
        sha256: createHash("sha256").update(pixels).digest("hex"),
      });
      expect(graphics.placements.find((candidate) => candidate.placementId === 8)?.layer).toBe(
        "below-text",
      );
      expect(graphics.placements.find((candidate) => candidate.placementId === 9)?.layer).toBe(
        "below-background",
      );
      expect(terminal.screen.getKittyImage(42)).toEqual(placement.image);
      expect(await terminal.graphics.copyImageData(42)).toEqual(pixels);
      expect("data" in terminal.screen.current().graphics.placements[0].image!).toBe(false);
    },
  );
});

test("inspected unplaced Kitty images survive later snapshots without retaining pixels", async () => {
  const pixels = new Uint8Array([255, 0, 0, 255]);
  const payload = Buffer.from(pixels).toString("base64");
  await withTerminalAsync(
    {
      command: node,
      args: [
        "-e",
        `process.stdout.write("\\x1b_Ga=t,f=32,s=1,v=1,i=42;${payload}\\x1b\\\\"); setTimeout(() => process.stdout.write("later"), 80); setTimeout(() => process.exit(0), 160)`,
      ],
      trace: "off",
    },
    async (terminal) => {
      await expectTerminal(terminal).toHaveShown(
        (snapshot) => snapshot.graphics.generation !== "0",
      );
      const inspected = await terminal.graphics.inspectImage(42);
      expect(inspected?.sha256).toBe(createHash("sha256").update(pixels).digest("hex"));
      await expectTerminal(terminal.getByText("later")).toBePresent();
      expect(terminal.screen.getKittyImage(42)).toEqual(inspected);
      expect("data" in terminal.screen.getKittyImage(42)!).toBe(false);
    },
  );
});

test("revision collection reports timeout distinctly from process exit", async () => {
  await withTerminalAsync(
    { command: node, args: ["-e", "setTimeout(() => process.exit(0), 200)"], trace: "off" },
    async (terminal) => {
      await expect(
        terminal.revisions.collect({ since: 0, until: () => false, timeoutMs: 20 }),
      ).rejects.toBeInstanceOf(TerminalAssertionError);
    },
  );
});
