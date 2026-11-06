import { EventEmitter } from "events";
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * rsync splits the `-e` command into words itself and reads the host out of `user@host:path`, so a
 * stored port or host that is no plain value would add options to ssh, like a ProxyCommand that runs
 * on the server DBackup runs on, or turn the remote path into a local one. The adapter refuses such a
 * config before it starts anything, also one stored before the check on save existed.
 */

const { mockExecCb, mockExecFileCb, mockSpawn } = vi.hoisted(() => ({ mockExecCb: vi.fn(), mockExecFileCb: vi.fn(), mockSpawn: vi.fn() }));

vi.mock("child_process", () => ({
    exec: mockExecCb,
    execFile: mockExecFileCb,
    spawn: mockSpawn,
    default: { exec: mockExecCb, execFile: mockExecFileCb, spawn: mockSpawn },
}));

vi.mock("fs/promises", () => ({
    default: { writeFile: vi.fn(), unlink: vi.fn(), mkdir: vi.fn(), readFile: vi.fn() },
    writeFile: vi.fn(), unlink: vi.fn(), mkdir: vi.fn(), readFile: vi.fn(),
}));

vi.mock("os", () => ({ default: { tmpdir: () => "/tmp" }, tmpdir: () => "/tmp" }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

import { RsyncAdapter } from "@/lib/adapters/storage/rsync";
import { RsyncSchema } from "@/lib/adapters/definitions";

/** An rsync that ends at once without an error. */
function finishedRsync() {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    queueMicrotask(() => proc.emit("close", 0, null));
    return proc;
}

const config = { host: "backup.example.com", port: 22, username: "admin", authType: "agent" as const, pathPrefix: "/backups" };

/** The SSH command each rsync was handed with -e. */
const shells = () => mockSpawn.mock.calls.filter(([binary]) => binary === "rsync").map(([, args]) => (args as string[])[(args as string[]).indexOf("-e") + 1]);

describe("the config values rsync and ssh parse themselves", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExecCb.mockImplementation((...args: unknown[]) => (args[args.length - 1] as (err: null, result: { stdout: string }) => void)(null, { stdout: "" }));
        mockExecFileCb.mockImplementation((...args: unknown[]) => (args[args.length - 1] as (err: null, result: { stdout: string }) => void)(null, { stdout: "" }));
        mockSpawn.mockImplementation(() => finishedRsync());
    });

    it.each([
        ["a port with words of its own", { port: "22 -oProxyCommand=touch /tmp/pwned" }],
        ["a port out of range", { port: 70000 }],
        ["a host that reads as an option of ssh", { host: "-oProxyCommand=touch /tmp/pwned" }],
        ["a host with a / that turns the remote path into a local one", { host: "evil/srv" }],
        ["a host with a : that names another path", { host: "backup.example.com:/etc" }],
        ["a host with a space", { host: "backup.example.com -v" }],
        ["a host with an @", { host: "other@backup.example.com" }],
    ])("starts neither ssh nor rsync for %s", async (_case, change) => {
        const uploaded = await RsyncAdapter.upload({ ...config, ...change } as never, "/tmp/backup.tar", "Job/backup.tar");

        expect(uploaded).toBe(false);
        expect(mockSpawn).not.toHaveBeenCalled();
        expect(mockExecFileCb).not.toHaveBeenCalled();
    });

    it("takes a port stored as text and an IPv6 address in brackets", async () => {
        const uploaded = await RsyncAdapter.upload({ ...config, host: "[2001:db8::1]", port: "2222" } as never, "/tmp/backup.tar", "Job/backup.tar");

        expect(uploaded).toBe(true);
        expect(shells()[0]).toMatch(/^ssh -p 2222 /);
        const args = mockSpawn.mock.calls.find(([binary]) => binary === "rsync")?.[1] as string[];
        expect(args.at(-1)).toBe("admin@[2001:db8::1]:/backups/Job/backup.tar");
    });

    it("refuses such a host or port on save, without naming it", () => {
        const base = { ...config, pathPrefix: "/backups" };
        for (const change of [{ port: "22 -oProxyCommand=x" }, { port: 65536 }, { host: "-oProxyCommand=x" }, { host: "evil/srv" }]) {
            const result = RsyncSchema.safeParse({ ...base, ...change });
            expect(result.success).toBe(false);
            expect(JSON.stringify(result.error?.issues)).not.toContain("ProxyCommand");
        }
        expect(RsyncSchema.safeParse({ ...base, port: "2222" }).success).toBe(true);
        expect(RsyncSchema.safeParse({ ...base, host: "[2001:db8::1]" }).success).toBe(true);
    });
});
