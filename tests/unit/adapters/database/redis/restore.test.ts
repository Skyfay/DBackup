import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisConfig } from "@/lib/adapters/definitions";

// --- Hoisted mocks ---

const {
    mockExecFileCb,
    mockFsStat,
} = vi.hoisted(() => ({
    mockExecFileCb: vi.fn(),
    mockFsStat: vi.fn(),
}));

// restore.ts uses util.promisify(execFile). Mock execFile so promisify wraps the mock.
vi.mock("child_process", () => ({
    execFile: mockExecFileCb,
    default: { execFile: mockExecFileCb },
}));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: any[]) => mockFsStat(...args) },
    stat: (...args: any[]) => mockFsStat(...args),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

import { prepareRestore, restore } from "@/lib/adapters/database/redis/restore";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

type RedisRestoreConfig = RedisConfig & { detectedVersion?: string };

function buildConfig(overrides: Partial<RedisRestoreConfig> = {}): RedisRestoreConfig {
    return {
        host: "localhost",
        port: 6379,
        ...overrides,
    } as RedisRestoreConfig;
}

/** Makes mockExecFileCb call its callback successfully with the given stdout. */
function execSucceeds(stdout = "") {
    mockExecFileCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (
            err: null,
            result: { stdout: string; stderr: string }
        ) => void;
        cb(null, { stdout, stderr: "" });
    });
}

/** Makes mockExecFileCb call its callback with an error. */
function execFails(message = "command failed", stderr = "") {
    mockExecFileCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error & { stderr?: string }) => void;
        const err = Object.assign(new Error(message), { stderr });
        cb(err);
    });
}

// -------------------------------------------------------------------------
// prepareRestore()
// -------------------------------------------------------------------------

describe("prepareRestore()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("resolves without error when PING succeeds and user is default", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                // PING
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "PONG\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                // ACL WHOAMI
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "default\n", stderr: "" });
            });

        await expect(prepareRestore(buildConfig(), [])).resolves.toBeUndefined();
    });

    it("resolves when user is non-default and ACL LIST contains allcommands", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                // PING
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "PONG\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                // ACL WHOAMI
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "backupuser\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                // ACL LIST
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "user backupuser on allcommands allkeys ~* &*\n", stderr: "" });
            });

        await expect(prepareRestore(buildConfig(), [])).resolves.toBeUndefined();
    });

    it("resolves when user is non-default and ACL LIST is missing both allcommands and +flushall", async () => {
        // This path logs a warning but still resolves successfully.
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "PONG\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "restricteduser\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "user restricteduser on +get +set ~* &*\n", stderr: "" });
            });

        await expect(prepareRestore(buildConfig(), [])).resolves.toBeUndefined();
    });

    it("throws when the PING command fails", async () => {
        execFails("Connection refused");

        await expect(prepareRestore(buildConfig(), [])).rejects.toThrow("Cannot connect to Redis");
    });

    it("includes a String-coerced value in the error when PING rejects with a non-Error", async () => {
        // Reject with a plain string to cover the `String(error)` branch.
        mockExecFileCb.mockImplementationOnce((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: unknown) => void;
            cb("plain string error");
        });

        await expect(prepareRestore(buildConfig(), [])).rejects.toThrow("plain string error");
    });

    it("resolves when ACL commands are unavailable (Redis < 6 catch block)", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                // PING succeeds
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "PONG\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                // ACL WHOAMI throws (Redis < 6)
                const cb = args[args.length - 1] as (err: Error) => void;
                cb(new Error("ERR unknown command 'ACL'"));
            });

        await expect(prepareRestore(buildConfig(), [])).resolves.toBeUndefined();
    });
});

// -------------------------------------------------------------------------
// restore()
// -------------------------------------------------------------------------

describe("restore()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 4096 });
    });

    it("returns success with manual-steps metadata when all steps succeed", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                // INFO server (engine detection)
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "redis_version:7.0.0\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                // CONFIG GET dir
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "dir\n/var/lib/redis\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                // CONFIG GET dbfilename
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "dbfilename\ndump.rdb\n", stderr: "" });
            });

        const result = await restore(buildConfig(), "/tmp/backup.rdb");

        expect(result.success).toBe(true);
        expect(result.metadata?.requiresManualSteps).toBe(true);
        expect(result.metadata?.dataDir).toBe("/var/lib/redis");
        expect(result.metadata?.rdbFilename).toBe("dump.rdb");
    });

    it("uses fallback dataDir and rdbFilename when CONFIG GET returns only the key line", async () => {
        // Simulates "dir\n" with no second line (lines[1] is empty -> fallback).
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                // INFO server (engine detection)
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "redis_version:7.0.0\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "dir\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "dbfilename\n", stderr: "" });
            });

        const result = await restore(buildConfig(), "/tmp/backup.rdb");

        expect(result.success).toBe(true);
        expect(result.metadata?.dataDir).toBe("/var/lib/redis");
        expect(result.metadata?.rdbFilename).toBe("dump.rdb");
    });

    it("invokes the onLog callback with progress messages", async () => {
        execSucceeds("dir\n/data\n");
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "dir\n/data\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "dbfilename\ndump.rdb\n", stderr: "" });
            });

        const logs: string[] = [];
        await restore(buildConfig(), "/tmp/backup.rdb", (msg) => logs.push(msg));

        expect(logs.some((l) => l.includes("restore"))).toBe(true);
    });

    it("returns failure when the source file does not exist (stat throws)", async () => {
        mockFsStat.mockRejectedValue(new Error("ENOENT: no such file or directory"));

        const result = await restore(buildConfig(), "/tmp/missing.rdb");

        expect(result.success).toBe(false);
        expect(result.error).toContain("ENOENT");
    });

    it("returns failure when CONFIG GET dir command fails", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                // INFO server (engine detection)
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "redis_version:7.0.0\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: Error) => void;
                cb(new Error("ERR CONFIG disabled"));
            });

        const result = await restore(buildConfig(), "/tmp/backup.rdb");

        expect(result.success).toBe(false);
        expect(result.error).toContain("ERR CONFIG disabled");
    });

    it("handles a non-Error rejection and coerces it to a string (String() branch)", async () => {
        // Reject with a plain string to cover the `String(error)` branch in the catch block.
        mockFsStat.mockRejectedValue("disk quota exceeded");

        const result = await restore(buildConfig(), "/tmp/backup.rdb");

        expect(result.success).toBe(false);
        expect(result.error).toContain("disk quota exceeded");
    });
});
