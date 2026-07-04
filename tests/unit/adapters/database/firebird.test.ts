import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// --- Mocks: child_process ---------------------------------------------------

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("child_process", () => {
    const mocked = {
        spawn: (...args: unknown[]) => mockSpawn(...args),
        execFile: vi.fn(),
    };
    return { ...mocked, default: mocked };
});

// --- Mocks: fs / fs/promises -------------------------------------------------

vi.mock("fs/promises", async () => {
    const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
    const mocked = {
        ...actual,
        stat: vi.fn(async () => ({ size: 1024 })),
    };
    return { ...mocked, default: mocked };
});

vi.mock("fs", async () => {
    const actual = await vi.importActual<typeof import("fs")>("fs");
    return {
        ...actual,
        createWriteStream: vi.fn(() => {
            const stream = new EventEmitter() as any;
            stream.pipe = vi.fn();
            return stream;
        }),
    };
});

// --- Mocks: SSH helpers -------------------------------------------------------

const { connectMock, execMock, execStreamMock, uploadFileMock, endMock } = vi.hoisted(() => ({
    connectMock: vi.fn(async () => {}),
    execMock: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    execStreamMock: vi.fn(),
    uploadFileMock: vi.fn(async () => {}),
    endMock: vi.fn(),
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: vi.fn(function SshClient() {
        return {
            connect: connectMock,
            exec: execMock,
            execStream: execStreamMock,
            uploadFile: uploadFileMock,
            end: endMock,
        };
    }),
    isSSHMode: vi.fn((config: any) => config.connectionMode === "ssh"),
    extractSshConfig: vi.fn(() => ({ host: "ssh-host", username: "root", authType: "password" })),
    remoteEnv: vi.fn((vars: Record<string, string | undefined>, cmd: string) => {
        const parts = Object.entries(vars)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => `export ${k}='${v}'`);
        return parts.length ? `${parts.join("; ")}; ${cmd}` : cmd;
    }),
    remoteBinaryCheck: vi.fn(async (_ssh: unknown, ...candidates: string[]) => candidates[0]),
    shellEscape: vi.fn((s: string) => `'${s}'`),
}));

import {
    resolveAliasPath,
    buildConnectionString,
    getDatabases,
    getDatabasesWithStats,
    test as testConnection,
} from "@/lib/adapters/database/firebird/connection";
import { dump } from "@/lib/adapters/database/firebird/dump";
import { restore } from "@/lib/adapters/database/firebird/restore";
import { analyzeDump } from "@/lib/adapters/database/firebird/analyze";
import * as tarUtils from "@/lib/adapters/database/common/tar-utils";

function createFakeProcess() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    return proc;
}

function createFakeSshStream() {
    const stream = new EventEmitter() as any;
    stream.pipe = vi.fn();
    stream.stderr = new EventEmitter();
    return stream;
}

const baseConfig = {
    host: "192.168.1.10",
    port: 3050,
    user: "SYSDBA",
    password: "masterkey",
    databases: [
        { name: "erp", path: "/data/erp.fdb" },
        { name: "crm", path: "/data/crm.fdb" },
    ],
    database: "erp",
    connectionMode: "direct",
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe("Firebird connection - resolveAliasPath", () => {
    it("resolves a configured alias to its path", () => {
        expect(resolveAliasPath(baseConfig as any, "crm")).toBe("/data/crm.fdb");
    });

    it("throws a clear error listing valid aliases for an unknown alias", () => {
        expect(() => resolveAliasPath(baseConfig as any, "accounting")).toThrow(
            /Unknown Firebird database alias "accounting".*erp, crm/
        );
    });
});

describe("Firebird connection - buildConnectionString", () => {
    it("omits the port segment for the default port in direct mode", () => {
        expect(buildConnectionString({ ...baseConfig, port: 3050 } as any, "/data/erp.fdb")).toBe(
            "192.168.1.10:/data/erp.fdb"
        );
    });

    it("includes a port segment for a non-default port in direct mode", () => {
        expect(buildConnectionString({ ...baseConfig, port: 3051 } as any, "/data/erp.fdb")).toBe(
            "192.168.1.10/3051:/data/erp.fdb"
        );
    });

    it("returns the bare local path in SSH mode regardless of host/port", () => {
        expect(
            buildConnectionString({ ...baseConfig, connectionMode: "ssh", port: 3051 } as any, "/data/erp.fdb")
        ).toBe("/data/erp.fdb");
    });
});

describe("Firebird connection - getDatabases / getDatabasesWithStats", () => {
    it("returns configured alias names without spawning any process", async () => {
        const result = await getDatabases(baseConfig as any);
        expect(result).toEqual(["erp", "crm"]);
        expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("returns alias entries with their path and undefined size/table count", async () => {
        const result = await getDatabasesWithStats(baseConfig as any);
        expect(result).toEqual([
            { name: "erp", path: "/data/erp.fdb" },
            { name: "crm", path: "/data/crm.fdb" },
        ]);
        expect(mockSpawn).not.toHaveBeenCalled();
    });
});

describe("Firebird connection - test()", () => {
    it("returns success and parses the engine version from isql output (direct mode)", async () => {
        mockSpawn.mockImplementation(() => {
            const proc = createFakeProcess();
            setImmediate(() => {
                proc.stdout.emit("data", Buffer.from("\nCONSTANT\n========\n5.0.1\n\n"));
                proc.emit("close", 0);
            });
            return proc;
        });

        const result = await testConnection(baseConfig as any);

        expect(result.success).toBe(true);
        expect(result.version).toBe("5.0.1");

        // Password must be passed via env, never in argv.
        const [, args, options] = mockSpawn.mock.calls[0];
        expect(args).not.toContain("masterkey");
        expect((options as any).env.ISC_PASSWORD).toBe("masterkey");
    });

    it("returns failure when no database aliases are configured", async () => {
        const result = await testConnection({ ...baseConfig, databases: [] } as any);
        expect(result.success).toBe(false);
        expect(mockSpawn).not.toHaveBeenCalled();
    });
});

describe("Firebird dump - direct mode", () => {
    it("runs gbak with -user on argv and ISC_PASSWORD only in env", async () => {
        mockSpawn.mockImplementation(() => {
            const proc = createFakeProcess();
            setImmediate(() => proc.emit("close", 0));
            return proc;
        });

        const result = await dump({ ...baseConfig, database: "erp" } as any, "/tmp/erp.fbk");

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
        expect(mockSpawn).toHaveBeenCalledTimes(1);

        const [bin, args, options] = mockSpawn.mock.calls[0];
        expect(bin).toBe("gbak");
        expect(args).toEqual(["-b", "-user", "SYSDBA", "192.168.1.10:/data/erp.fdb", "/tmp/erp.fbk"]);
        expect(args).not.toContain("masterkey");
        expect((options as any).env.ISC_PASSWORD).toBe("masterkey");
    });

    it("fails with a clear error for an unknown alias", async () => {
        const result = await dump({ ...baseConfig, database: "unknown" } as any, "/tmp/unknown.fbk");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unknown Firebird database alias "unknown"/);
        expect(mockSpawn).not.toHaveBeenCalled();
    });
});

describe("Firebird dump - SSH mode", () => {
    it("streams gbak stdout to the local destination file via remoteEnv", async () => {
        execStreamMock.mockImplementation((_cmd: string, cb: (err: unknown, stream: unknown) => void) => {
            const stream = createFakeSshStream();
            cb(null, stream);
            setImmediate(() => stream.emit("exit", 0));
        });

        const sshConfig = { ...baseConfig, connectionMode: "ssh", database: "erp" };
        const result = await dump(sshConfig as any, "/tmp/erp.fbk");

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
        expect(execStreamMock).toHaveBeenCalledTimes(1);

        const [cmd] = execStreamMock.mock.calls[0];
        expect(cmd).toContain("export ISC_PASSWORD='masterkey'");
        expect(cmd).toContain("gbak -b -user 'SYSDBA' '/data/erp.fdb' stdout");
    });
});

describe("Firebird restore - direct mode", () => {
    it("always uses -rep (replace) and passes ISC_PASSWORD via env", async () => {
        mockSpawn.mockImplementation(() => {
            const proc = createFakeProcess();
            setImmediate(() => proc.emit("close", 0));
            return proc;
        });

        const result = await restore({ ...baseConfig, database: "erp" } as any, "/tmp/erp.fbk");

        expect(result.success).toBe(true);
        const [bin, args, options] = mockSpawn.mock.calls[0];
        expect(bin).toBe("gbak");
        expect(args).toEqual(["-rep", "-user", "SYSDBA", "/tmp/erp.fbk", "192.168.1.10:/data/erp.fdb"]);
        expect(args).not.toContain("masterkey");
        expect((options as any).env.ISC_PASSWORD).toBe("masterkey");
    });

    it("fails with a clear error when leaving the field empty resolves to an unconfigured alias", async () => {
        const result = await restore({ ...baseConfig, database: "unknown" } as any, "/tmp/erp.fbk");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unknown Firebird database alias "unknown"/);
    });

    it("treats an explicit targetDatabaseName as a literal path, bypassing alias resolution", async () => {
        mockSpawn.mockImplementation(() => {
            const proc = createFakeProcess();
            setImmediate(() => proc.emit("close", 0));
            return proc;
        });

        const result = await restore(
            { ...baseConfig, database: "erp", targetDatabaseName: "/custom/new-location.fdb" } as any,
            "/tmp/erp.fbk"
        );

        expect(result.success).toBe(true);
        const [, args] = mockSpawn.mock.calls[0];
        expect(args).toEqual(["-rep", "-user", "SYSDBA", "/tmp/erp.fbk", "192.168.1.10:/custom/new-location.fdb"]);
    });
});

describe("Firebird restore - SSH mode", () => {
    it("uploads the backup file then runs gbak -rep remotely via remoteEnv", async () => {
        execStreamMock.mockImplementation((_cmd: string, cb: (err: unknown, stream: unknown) => void) => {
            const stream = createFakeSshStream();
            cb(null, stream);
            setImmediate(() => stream.emit("exit", 0));
        });

        const sshConfig = { ...baseConfig, connectionMode: "ssh", database: "erp" };
        const result = await restore(sshConfig as any, "/tmp/erp.fbk");

        expect(result.success).toBe(true);
        expect(uploadFileMock).toHaveBeenCalledTimes(1);

        const [cmd] = execStreamMock.mock.calls[0];
        expect(cmd).toContain("export ISC_PASSWORD='masterkey'");
        expect(cmd).toContain("gbak -rep -user 'SYSDBA'");
        expect(cmd).toContain("'/data/erp.fdb'");
    });
});

describe("Firebird analyze - analyzeDump", () => {
    it("returns database names from the manifest for a Multi-DB TAR archive", async () => {
        vi.spyOn(tarUtils, "isMultiDbTar").mockResolvedValue(true);
        vi.spyOn(tarUtils, "readTarManifest").mockResolvedValue({
            version: 1,
            createdAt: new Date().toISOString(),
            sourceType: "firebird",
            databases: [
                { name: "erp", filename: "erp.fbk", size: 100, format: "fbk" },
                { name: "crm", filename: "crm.fbk", size: 200, format: "fbk" },
            ],
            totalSize: 300,
        } as any);

        const result = await analyzeDump("/tmp/backup.tar");
        expect(result).toEqual(["erp", "crm"]);
    });

    it("returns an empty array for a single .fbk file (binary format, not introspectable)", async () => {
        vi.spyOn(tarUtils, "isMultiDbTar").mockResolvedValue(false);

        const result = await analyzeDump("/tmp/erp.fbk");
        expect(result).toEqual([]);
    });
});
