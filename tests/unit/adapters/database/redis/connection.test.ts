import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisConfig } from "@/lib/adapters/definitions";

// --- Hoisted mocks ---

const {
    mockExecFileCb,
    mockIsSSHMode,
    mockSshExec,
    mockRemoteBinaryCheck,
} = vi.hoisted(() => ({
    mockExecFileCb: vi.fn(),
    mockIsSSHMode: vi.fn(),
    mockSshExec: vi.fn(),
    mockRemoteBinaryCheck: vi.fn(),
}));

// connection.ts uses util.promisify(execFile). Mock execFile so promisify wraps the mock.
vi.mock("child_process", () => ({
    execFile: mockExecFileCb,
    default: { execFile: mockExecFileCb },
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect = vi.fn().mockResolvedValue(undefined);
        exec = (...args: any[]) => mockSshExec(...args);
        end = vi.fn();
    },
    isSSHMode: (...args: any[]) => mockIsSSHMode(...args),
    extractSshConfig: vi.fn(() => ({ host: "jump.example.com", port: 22 })),
    buildRedisArgs: vi.fn(() => ["-h", "db.internal", "-p", "6379"]),
    remoteBinaryCheck: (...args: any[]) => mockRemoteBinaryCheck(...args),
    shellEscape: vi.fn((s: string) => s),
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

vi.mock("@/lib/logging/errors", () => ({
    wrapError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

import {
    test,
    getDatabases,
    getDatabasesWithStats,
    buildConnectionArgs,
} from "@/lib/adapters/database/redis/connection";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function buildConfig(overrides: Partial<RedisConfig> = {}): RedisConfig {
    return {
        host: "localhost",
        port: 6379,
        ...overrides,
    } as RedisConfig;
}

/** Callback-style execFile mock that succeeds with the given stdout. */
function execSucceeds(stdout = "") {
    mockExecFileCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (
            err: null,
            result: { stdout: string; stderr: string }
        ) => void;
        cb(null, { stdout, stderr: "" });
    });
}

/** Callback-style execFile mock that fails. */
function execFails(message = "command failed", stderr = "") {
    mockExecFileCb.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error & { stderr?: string }) => void;
        const err = Object.assign(new Error(message), { stderr });
        cb(err);
    });
}

// -------------------------------------------------------------------------
// buildConnectionArgs
// -------------------------------------------------------------------------

describe("buildConnectionArgs", () => {
    it("returns [-h, host, -p, port] for a minimal config", () => {
        const args = buildConnectionArgs(buildConfig());
        expect(args).toEqual(["-h", "localhost", "-p", "6379"]);
    });

    it("adds --user and value when username is set", () => {
        const args = buildConnectionArgs(buildConfig({ username: "admin" }));
        expect(args).toContain("--user");
        expect(args).toContain("admin");
    });

    it("adds -a and value when password is set", () => {
        const args = buildConnectionArgs(buildConfig({ password: "secret" }));
        expect(args).toContain("-a");
        expect(args).toContain("secret");
    });

    it("adds --tls when tls is true", () => {
        const args = buildConnectionArgs(buildConfig({ tls: true }));
        expect(args).toContain("--tls");
    });

    it("does NOT add --tls when tls is false", () => {
        const args = buildConnectionArgs(buildConfig({ tls: false }));
        expect(args).not.toContain("--tls");
    });

    it("adds -n and the database index when database > 0", () => {
        const args = buildConnectionArgs(buildConfig({ database: 3 }));
        expect(args).toContain("-n");
        expect(args).toContain("3");
    });

    it("does NOT add -n when database is 0", () => {
        const args = buildConnectionArgs(buildConfig({ database: 0 }));
        expect(args).not.toContain("-n");
    });

    it("does NOT add -n when database is undefined", () => {
        const args = buildConnectionArgs(buildConfig({ database: undefined }));
        expect(args).not.toContain("-n");
    });
});

// -------------------------------------------------------------------------
// test() - local
// -------------------------------------------------------------------------

describe("test() - local", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    it("returns success with parsed version on valid PONG + INFO response", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "PONG\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "# Server\r\nredis_version:7.2.3\r\nredis_mode:standalone\r\n", stderr: "" });
            });

        const result = await test(buildConfig());

        expect(result.success).toBe(true);
        expect(result.message).toContain("Connection successful");
        expect(result.version).toBe("7.2.3");
    });

    it("returns success with undefined version when INFO output has no version line", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "PONG\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "# Server\r\nno_version_here:true\r\n", stderr: "" });
            });

        const result = await test(buildConfig());

        expect(result.success).toBe(true);
        expect(result.version).toBeUndefined();
    });

    it("returns failure when PING response does not include PONG", async () => {
        execSucceeds("ERR wrong type\n");

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("PONG");
    });

    it("returns failure with stderr when execFile throws with stderr", async () => {
        execFails("command failed", "Connection refused");

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("Connection refused");
    });

    it("returns failure with error message when execFile throws without stderr", async () => {
        execFails("connect ECONNREFUSED");

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("connect ECONNREFUSED");
    });

    it("uses 'Unknown error' fallback when the caught object has neither stderr nor message", async () => {
        // Throw a plain object with no message/stderr to trigger the final || fallback.
        mockExecFileCb.mockImplementationOnce((...args: unknown[]) => {
            const cb = args[args.length - 1] as (err: unknown) => void;
            cb({});
        });

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("Unknown error");
    });
});

// -------------------------------------------------------------------------
// test() - SSH
// -------------------------------------------------------------------------

describe("test() - SSH", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(true);
        mockRemoteBinaryCheck.mockResolvedValue("redis-cli");
    });

    it("returns success via SSH with parsed version", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "PONG\n", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "redis_version:7.0.0\r\n", stderr: "" });

        const result = await test(buildConfig());

        expect(result.success).toBe(true);
        expect(result.message).toContain("SSH");
        expect(result.version).toBe("7.0.0");
    });

    it("returns success via SSH with undefined version when INFO returns non-zero code", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "PONG\n", stderr: "" })
            .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "INFO not allowed" });

        const result = await test(buildConfig());

        expect(result.success).toBe(true);
        expect(result.version).toBeUndefined();
    });

    it("returns failure via SSH when PING returns non-zero exit code", async () => {
        mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "AUTH required" });

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("SSH Redis PING failed");
    });

    it("returns failure via SSH when PING stdout does not include PONG", async () => {
        mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "NOAUTH Authentication required\n", stderr: "" });

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("SSH Redis PING failed");
    });

    it("returns failure when SSH operation throws an Error", async () => {
        mockRemoteBinaryCheck.mockRejectedValue(new Error("SSH transport error"));

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("SSH connection failed");
        expect(result.message).toContain("SSH transport error");
    });

    it("returns failure when SSH operation rejects with a non-Error value", async () => {
        mockRemoteBinaryCheck.mockRejectedValue("timeout");

        const result = await test(buildConfig());

        expect(result.success).toBe(false);
        expect(result.message).toContain("SSH connection failed");
    });

    it("adds tls flag and -n option via SSH when config has tls=true and database > 0", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "PONG\n", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "redis_version:7.0.0\r\n", stderr: "" });

        const result = await test(buildConfig({ tls: true, database: 3 }));

        expect(result.success).toBe(true);
        expect(result.version).toBe("7.0.0");
    });

    it("returns undefined version when INFO code=0 but output contains no redis_version line", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "PONG\n", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "# Server\r\nno_version_field:true\r\n", stderr: "" });

        const result = await test(buildConfig());

        expect(result.success).toBe(true);
        expect(result.version).toBeUndefined();
    });
});

// -------------------------------------------------------------------------
// getDatabases() - local
// -------------------------------------------------------------------------

describe("getDatabases() - local", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    it("returns indices 0..N-1 when CONFIG GET returns a valid count", async () => {
        execSucceeds("databases\n8\n");

        const result = await getDatabases(buildConfig());

        expect(result).toHaveLength(8);
        expect(result[0]).toBe("0");
        expect(result[7]).toBe("7");
    });

    it("falls back to 16 databases when CONFIG GET returns only the key (no count line)", async () => {
        // "databases\n" has no second line -> parseInt("" || "16") -> 16
        execSucceeds("databases\n");

        const result = await getDatabases(buildConfig());

        expect(result).toHaveLength(16);
    });

    it("falls back to 16 databases when execFile throws", async () => {
        execFails("ERR config disabled");

        const result = await getDatabases(buildConfig());

        expect(result).toHaveLength(16);
        expect(result[0]).toBe("0");
        expect(result[15]).toBe("15");
    });
});

// -------------------------------------------------------------------------
// getDatabases() - SSH
// -------------------------------------------------------------------------

describe("getDatabases() - SSH", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(true);
        mockRemoteBinaryCheck.mockResolvedValue("redis-cli");
    });

    it("returns indices 0..N-1 via SSH when CONFIG GET succeeds", async () => {
        mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "databases\n4\n", stderr: "" });

        const result = await getDatabases(buildConfig());

        expect(result).toHaveLength(4);
        expect(result).toEqual(["0", "1", "2", "3"]);
    });

    it("uses 16 as fallback when SSH CONFIG GET returns only the key (no count line)", async () => {
        // Only the key line with no number -> parseInt("" || "16") -> 16
        mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "databases\n", stderr: "" });

        const result = await getDatabases(buildConfig());

        expect(result).toHaveLength(16);
    });

    it("falls back to 16 databases via SSH when exec returns non-zero code", async () => {
        mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "CONFIG disabled" });

        const result = await getDatabases(buildConfig());

        expect(result).toHaveLength(16);
    });

    it("falls back to 16 databases via SSH when operation throws", async () => {
        mockRemoteBinaryCheck.mockRejectedValue(new Error("SSH disconnected"));

        const result = await getDatabases(buildConfig());

        expect(result).toHaveLength(16);
    });
});

// -------------------------------------------------------------------------
// getDatabasesWithStats() - local
// -------------------------------------------------------------------------

describe("getDatabasesWithStats() - local", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    it("maps INFO keyspace output to per-db key counts, defaulting empty dbs to 0", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "databases\n4\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "# Keyspace\r\ndb0:keys=1234,expires=0,avg_ttl=0\r\ndb2:keys=5,expires=1,avg_ttl=0\r\n", stderr: "" });
            });

        const result = await getDatabasesWithStats(buildConfig());

        expect(result).toEqual([
            { name: "0", tableCount: 1234 },
            { name: "1", tableCount: 0 },
            { name: "2", tableCount: 5 },
            { name: "3", tableCount: 0 },
        ]);
        expect(result.every((db) => db.sizeInBytes === undefined)).toBe(true);
    });

    it("returns bare names without tableCount when the INFO command fails", async () => {
        mockExecFileCb
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: null, r: { stdout: string; stderr: string }) => void;
                cb(null, { stdout: "databases\n2\n", stderr: "" });
            })
            .mockImplementationOnce((...args: unknown[]) => {
                const cb = args[args.length - 1] as (err: Error) => void;
                cb(new Error("NOAUTH"));
            });

        const result = await getDatabasesWithStats(buildConfig());

        expect(result).toEqual([{ name: "0" }, { name: "1" }]);
    });
});

// -------------------------------------------------------------------------
// getDatabasesWithStats() - SSH
// -------------------------------------------------------------------------

describe("getDatabasesWithStats() - SSH", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(true);
        mockRemoteBinaryCheck.mockResolvedValue("redis-cli");
    });

    it("maps INFO keyspace output to per-db key counts via SSH", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "databases\n2\n", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "db1:keys=42,expires=0,avg_ttl=0\r\n", stderr: "" });

        const result = await getDatabasesWithStats(buildConfig());

        expect(result).toEqual([
            { name: "0", tableCount: 0 },
            { name: "1", tableCount: 42 },
        ]);
    });

    it("returns bare names when the SSH operation throws", async () => {
        mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "databases\n2\n", stderr: "" });
        mockRemoteBinaryCheck.mockResolvedValueOnce("redis-cli").mockRejectedValueOnce(new Error("SSH disconnected"));

        const result = await getDatabasesWithStats(buildConfig());

        expect(result).toEqual([{ name: "0" }, { name: "1" }]);
    });
});
