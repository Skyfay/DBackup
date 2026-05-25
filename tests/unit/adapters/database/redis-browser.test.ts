import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const { mockExecFile, mockIsSSHMode } = vi.hoisted(() => ({
    mockExecFile: vi.fn(),
    mockIsSSHMode: vi.fn().mockReturnValue(false),
}));

// Include `default` export so CJS interop works correctly.
vi.mock("child_process", () => ({
    execFile: mockExecFile,
    default: { execFile: mockExecFile },
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect = vi.fn();
        exec = vi.fn();
        end = vi.fn();
    },
    isSSHMode: (...args: unknown[]) => mockIsSSHMode(...args),
    extractSshConfig: vi.fn(),
    buildRedisArgs: vi.fn(() => ["-h", "localhost", "-p", "6379"]),
    remoteBinaryCheck: vi.fn(),
}));

import { getTables, getTableData } from "@/lib/adapters/database/redis/browser";

/**
 * Helper: queue callback-style results for execFile calls.
 * util.promisify(execFile) resolves with { stdout, stderr } so the callback
 * must receive the result as a single object (matching Node's custom promisify).
 */
function queueExecResponses(...responses: Array<{ stdout: string; stderr?: string }>) {
    for (const r of responses) {
        mockExecFile.mockImplementationOnce((...args: unknown[]) => {
            const cb = args[args.length - 1] as (
                err: null,
                result: { stdout: string; stderr: string }
            ) => void;
            cb(null, { stdout: r.stdout, stderr: r.stderr ?? "" });
        });
    }
}

const baseConfig = {
    host: "localhost",
    port: 6379,
};

describe("Redis browser - getTables", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    it("returns a single 'Keys' table with DBSIZE as rowCount", async () => {
        queueExecResponses({ stdout: "42\n" });

        const result = await getTables(baseConfig as any, "0");

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ name: "Keys", type: "table", rowCount: 42 });
    });

    it("returns rowCount 0 when DBSIZE output is not a number", async () => {
        queueExecResponses({ stdout: "ERR\n" });

        const result = await getTables(baseConfig as any, "0");

        expect(result[0].rowCount).toBe(0);
    });
});

describe("Redis browser - getTableData", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    const options = {
        database: "0",
        table: "Keys",
        page: 1,
        pageSize: 10,
    };

    it("returns rows with key, type and ttl columns", async () => {
        queueExecResponses(
            { stdout: "2\n" },                              // DBSIZE
            { stdout: "0\nfoo\nbar\n" },                   // SCAN
            { stdout: '1) "string\t30"\n2) "hash\t-1"\n' } // EVAL
        );

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.totalCount).toBe(2);
        expect(result.columns.map(c => c.name)).toEqual(["key", "type", "ttl"]);
        expect(result.rows).toHaveLength(2);
    });

    it("formats TTL -1 as 'no expiry'", async () => {
        queueExecResponses(
            { stdout: "1\n" },
            { stdout: "0\nmykey\n" },
            { stdout: '1) "string\t-1"\n' }
        );

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.rows[0].ttl).toBe("no expiry");
    });

    it("formats TTL -2 as 'expired'", async () => {
        queueExecResponses(
            { stdout: "1\n" },
            { stdout: "0\nexpiredkey\n" },
            { stdout: '1) "string\t-2"\n' }
        );

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.rows[0].ttl).toBe("expired");
    });

    it("formats positive TTL with 's' suffix", async () => {
        queueExecResponses(
            { stdout: "1\n" },
            { stdout: "0\ntmpkey\n" },
            { stdout: '1) "string\t120"\n' }
        );

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.rows[0].ttl).toBe("120s");
    });
});
