import { expectTerminal, withTerminalAsync } from "../dist/index.js";

await withTerminalAsync(
    { command: "/bin/sh", args: ["-c", "printf runtime-smoke"], trace: "off" },
    async (terminal) => {
        await expectTerminal(terminal.getByText("runtime-smoke")).toBePresent();
        const status = await terminal.process.waitForExit();
        if (status.exitCode !== 0 || !status.ptyEof) {
            throw new Error(`unexpected process status: ${JSON.stringify(status)}`);
        }
    },
);
console.log("Ghostwright runtime smoke passed");
