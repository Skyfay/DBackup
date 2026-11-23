// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";

/**
 * smbclient writes what it gets into a local file and cannot stop at a size. The read watches the
 * file and kills smbclient through the signal once it passes the limit. smbclient is played here by
 * a writer into the real file, which stops only when its signal aborts, like a server that sends
 * without end.
 */
const { mockRunSmbclient } = vi.hoisted(() => ({ mockRunSmbclient: vi.fn() }));
vi.mock("@/lib/adapters/storage/smb-run", () => ({ runSmbclient: mockRunSmbclient }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { SMBAdapter } from "@/lib/adapters/storage/smb";
import { FileTooLargeError } from "@/lib/adapters/storage/common/read-limit";

const config = { address: "//server/share", username: "user", password: "secret", domain: "", maxProtocol: "SMB3" } as never;

/** The local file of a `get` command, the last quoted part of its `-c` argument. */
function destinationOf(args: string[]): string {
    const command = args[args.indexOf("-c") + 1];
    const match = /"([^"]+)"\s*$/.exec(command);
    if (!match) throw new Error(`no destination in ${command}`);
    return match[1];
}

describe("SMB read with a limit", () => {
    beforeEach(() => {
        mockRunSmbclient.mockReset();
    });

    it("kills smbclient once the file it writes passes the limit", async () => {
        let written = 0;
        mockRunSmbclient.mockImplementation(async (args: string[], options: { signal?: AbortSignal }) => {
            const target = destinationOf(args);
            const handle = await fs.open(target, "w");
            try {
                while (!options.signal?.aborted) {
                    await handle.write(Buffer.alloc(64 * 1024));
                    written += 64 * 1024;
                    // A server that sends without end, stopped only by the signal, or by the test.
                    if (written > 64 * 1024 * 1024) throw new Error("never stopped");
                    await new Promise((resolve) => setTimeout(resolve, 5));
                }
            } finally {
                await handle.close();
            }
            throw Object.assign(new Error("aborted"), { name: "AbortError" });
        });

        await expect(SMBAdapter.readBytes!(config, "Job/x.index", { maxBytes: 256 * 1024 })).rejects.toBeInstanceOf(FileTooLargeError);
        expect(written).toBeLessThan(16 * 1024 * 1024);
    });

    it("refuses a file that passed the limit before the watch looked", async () => {
        mockRunSmbclient.mockImplementation(async (args: string[]) => {
            await fs.writeFile(destinationOf(args), Buffer.alloc(2048));
            return "";
        });

        await expect(SMBAdapter.read!(config, "Job/x.meta.json", { maxBytes: 1024 })).rejects.toBeInstanceOf(FileTooLargeError);
    });

    it("reads a file within the limit", async () => {
        mockRunSmbclient.mockImplementation(async (args: string[]) => {
            await fs.writeFile(destinationOf(args), "{\"ok\":true}");
            return "";
        });

        expect(await SMBAdapter.read!(config, "Job/x.meta.json")).toBe("{\"ok\":true}");
    });

    it("answers null for a file that is not there", async () => {
        mockRunSmbclient.mockRejectedValue(new Error("NT_STATUS_OBJECT_NAME_NOT_FOUND"));

        expect(await SMBAdapter.read!(config, "Job/missing.meta.json")).toBeNull();
    });
});
