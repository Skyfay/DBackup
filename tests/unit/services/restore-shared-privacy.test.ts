/**
 * A restore a customer starts of a database on a shared server lands in the customer's History and
 * on the customer's channels. These run the real restore pipeline over a real archive and check
 * that the run and its notifications name the customer's database and nothing else of the
 * server: not its address, port or login, not the archive, its destination or the other databases.
 * The tenant of the server gets a run of the same restore that reads every line in full.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { createReadStream } from "fs";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { registry } from "@/lib/core/registry";
import { createArchive } from "@/lib/archive/writer";
import type { ArchiveSourceEntry } from "@/lib/archive/types";
import { notify } from "@/services/notifications/system-notification-service";
import { registerExecution, unregisterExecution } from "@/lib/execution/abort";
import { runRestorePipeline } from "@/services/restore/pipeline";
import type { RestoreInput } from "@/services/restore/types";

let workDir: string;
let tempDir: string;

vi.mock("@/lib/core/registry", () => ({ registry: { get: vi.fn() } }));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => tempDir }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: vi.fn(async (row: { config: string }) => JSON.parse(row.config)),
}));
vi.mock("@/lib/execution/abort", () => ({
    registerExecution: vi.fn(() => new AbortController()),
    unregisterExecution: vi.fn(),
}));
vi.mock("@/lib/execution/queue-manager", () => ({ processQueue: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));

const ARCHIVE = "nightly/2026-10-15_0214_nightly.tar";
const storageRow = { id: "msp-nas", type: "storage", adapterId: "msp-fs", name: "MSP NAS", config: "{}" };
const serverRow = {
    id: "shared-mysql", type: "database", adapterId: "mysql", name: "Shared MySQL",
    config: JSON.stringify({ host: "db7.msp.internal", port: 3306, user: "dbackup", password: "pw-1234" }),
};
/** Everything of the server and the backup the customer must never read. */
const HIDDEN = ["db7.msp.internal", "3306", "dbackup", "pw-1234", "10.20.0.9", "nightly", "MSP NAS", "msp-nas", "shop_globex", "max_allowed_packet", "Scope:"];

const SHARED: RestoreInput = {
    storageConfigId: "msp-nas",
    file: ARCHIVE,
    scope: "databases",
    targetSourceId: "shared-mysql",
    databaseMapping: [{ originalName: "shop_acme", targetName: "shop_acme", selected: true }],
    shared: { databaseName: "shop_acme" },
};
/** The run of the tenant of the server, beside the customer's run-1. */
const PROVIDER_RUN = { id: "msp-run", provider: "Skyfay Hosting", customer: "Acme" };

/** An archive of the server with two customers' databases, its index and metadata beside it. */
async function writeBackup() {
    const entries: ArchiveSourceEntry[] = [];
    for (const dbName of ["shop_acme", "shop_globex"]) {
        const dump = path.join(workDir, `${dbName}.sql`);
        await fs.writeFile(dump, `-- dump of ${dbName}`);
        entries.push({ kind: "database", dbName, path: dump, format: "sql" });
    }
    const tarPath = path.join(workDir, ARCHIVE);
    await fs.mkdir(path.dirname(tarPath), { recursive: true });
    const { indexBytes } = await createArchive(entries, tarPath, { sourceType: "mysql" });
    await fs.writeFile(`${tarPath}.index`, indexBytes);
    await fs.writeFile(`${tarPath}.meta.json`, JSON.stringify({ version: 1, archive: { formatVersion: 2, indexFile: ".index", encrypted: false } }));
}

/** The destination of the MSP, which serves the archive by range unless told it does not answer. */
function wire(restoreOne: (...args: unknown[]) => Promise<void>, options: { archiveAnswers?: boolean } = {}) {
    const storage = {
        id: "msp-fs",
        read: async (_c: unknown, remote: string) => fs.readFile(path.join(workDir, remote), "utf-8").catch(() => null),
        download: async (_c: unknown, remote: string, local: string) => {
            if (options.archiveAnswers === false && remote.endsWith(".tar")) return false;
            return fs.copyFile(path.join(workDir, remote), local).then(() => true, () => false);
        },
        downloadRange: async (_c: unknown, remote: string, start: number, end: number) => {
            if (options.archiveAnswers === false) throw new Error(`ECONNREFUSED 10.20.0.9 while reading ${remote}`);
            return end < start ? Readable.from([]) : createReadStream(path.join(workDir, remote), { start, end });
        },
    };
    const database = { id: "mysql", type: "database", restoreOne: vi.fn(restoreOne), test: vi.fn().mockResolvedValue({ success: true, version: "8.0.36" }) };
    prismaMock.execution.update.mockResolvedValue({} as never);
    prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) =>
        where.id === "msp-nas" ? storageRow : where.id === "shared-mysql" ? serverRow : null) as never);
    vi.mocked(registry.get).mockImplementation(((id: string) => (id === "msp-fs" ? storage : database)) as never);
    return { database };
}

/** What MySQL logs on a restore: the server's settings, the command with its login and its own errors. */
async function mysqlLike(_config: unknown, _dump: unknown, target: unknown, _host: unknown, onLog: unknown) {
    const log = onLog as (msg: string, level?: string, type?: string, details?: string) => void;
    log("Server settings: max_allowed_packet=67108864 innodb_buffer_pool_size=134217728");
    log(`Restoring to database: ${target}`, "info", "command", `mysql -h db7.msp.internal -P 3306 -u dbackup ${target}`);
    log("MySQL: Warning: lost the connection to db7.msp.internal:3306 for a moment", "warning");
}

type Update = [{ where: { id: string }; data: { logs?: string; metadata?: string; status?: string } }];

/** The last value a run wrote of a field. */
function lastOf(id: string, field: "logs" | "metadata" | "status"): string | undefined {
    const calls = prismaMock.execution.update.mock.calls as unknown as Update[];
    return calls.filter((call) => call[0].where.id === id).map((call) => call[0].data[field]).filter(Boolean).pop();
}

function runLog(id = "run-1"): { message: string; details?: string }[] {
    const last = lastOf(id, "logs");
    return last ? JSON.parse(last) : [];
}

function runMetadata(id = "run-1"): Record<string, unknown> {
    const last = lastOf(id, "metadata");
    return last ? JSON.parse(last) : {};
}

function runTarget(): unknown {
    return runMetadata().target;
}

function expectNothingOfTheServer(text: string) {
    for (const hidden of HIDDEN) expect(text, `the run names ${hidden}`).not.toContain(hidden);
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "shared-privacy-"));
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "shared-privacy-tmp-"));
    await writeBackup();
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe("the run of a restore a customer starts on a shared server", () => {
    it("names the customer's database and what happened to it, and nothing else of the server or the backup", async () => {
        const { database } = wire(mysqlLike);
        await runRestorePipeline("run-1", SHARED);

        expect(database.restoreOne).toHaveBeenCalledTimes(1);
        const log = runLog();
        expect(log.map((entry) => entry.message)).toEqual(expect.arrayContaining([
            "Restoring to database: shop_acme",
            "MySQL: Warning: lost the connection to the server for a moment",
            "Database restored: shop_acme",
        ]));
        expect(log.filter((entry) => entry.details !== undefined)).toEqual([]);
        expectNothingOfTheServer(JSON.stringify(log));
        // The server keeps the name the customer sees, never the id of its connection.
        expect(runTarget()).toEqual({ name: "Shared MySQL", adapterId: "mysql" });
    });

    it("tells the customer's channels about the database alone, without the destination", async () => {
        wire(mysqlLike);
        await runRestorePipeline("run-1", SHARED);

        const [event] = vi.mocked(notify).mock.calls[0];
        expect(event.data).toEqual(expect.objectContaining({ backupFile: "shop_acme", targetDatabase: "shop_acme", executionId: "run-1" }));
        expect(event.data).not.toHaveProperty("storageName");
        expectNothingOfTheServer(JSON.stringify(event.data));
    });

    it("says why the database failed in neutral words", async () => {
        wire(async () => {
            throw new Error("ERROR 1045 (28000): Access denied for user 'dbackup'@'10.20.0.9' on db7.msp.internal:3306");
        });
        await runRestorePipeline("run-1", SHARED);

        const messages = runLog().map((entry) => entry.message);
        expect(messages).toContain("Failed to restore database 'shop_acme': ERROR 1045 (28000): Access denied for user 'the user'@'an address' on the server");
        expect(messages).toContain("Restore failed: shop_acme could not be restored.");
        // Without a run of the provider there is none to point to.
        expect(messages.some((message) => message.includes("sees the full run"))).toBe(false);
        expectNothingOfTheServer(JSON.stringify(runLog()));
    });

    it("names neither another database the server holds nor another host of its domain in an error of its tools", async () => {
        wire(async () => {
            throw new Error("ERROR 1049 (42000): Unknown database 'wiki_initech' on replica2.msp.internal");
        });
        // The databases the server listed last, which the backup does not hold.
        prismaMock.databaseListCache.findUnique.mockResolvedValueOnce({ databasesJson: JSON.stringify(["shop_acme", "wiki_initech"]) } as never);
        await runRestorePipeline("run-1", SHARED);

        const text = JSON.stringify(runLog());
        expect(text).not.toContain("wiki_initech");
        expect(text).not.toContain("replica2");
        expect(runLog().map((entry) => entry.message)).toContain("Failed to restore database 'shop_acme': ERROR 1049 (42000): Unknown database 'another database' on the server");
    });

    it("ends on a line that names nothing of the archive when the destination does not answer, and keeps the error out of the notification", async () => {
        wire(mysqlLike, { archiveAnswers: false });
        await runRestorePipeline("run-1", SHARED);

        expect(runLog().map((entry) => entry.message)).toContain("Fatal Error: The restore of shop_acme stopped with an error.");
        expectNothingOfTheServer(JSON.stringify(runLog()));
        const [event] = vi.mocked(notify).mock.calls[0];
        expect(event.eventType).toBe("restore_failure");
        expect(event.data).toEqual(expect.objectContaining({ backupFile: "shop_acme", error: "The restore of shop_acme stopped with an error." }));
        expect(event.data).not.toHaveProperty("storageName");
        expectNothingOfTheServer(JSON.stringify(event.data));
    });

    it("says only that the metadata could not be read when it is broken", async () => {
        await fs.writeFile(path.join(workDir, `${ARCHIVE}.meta.json`), `${ARCHIVE} is no JSON`);
        wire(mysqlLike);
        await runRestorePipeline("run-1", SHARED);

        expect(runLog().map((entry) => entry.message)).toContain("Warning: The metadata of the backup could not be read.");
        expectNothingOfTheServer(JSON.stringify(runLog()));
    });

    it("keeps the command, the archive and the destination in the run of the server's own restore", async () => {
        wire(mysqlLike);
        const { shared: _shared, ...own } = SHARED;
        await runRestorePipeline("run-1", own);

        const log = runLog();
        expect(log.find((entry) => entry.message === "Restoring to database: shop_acme")?.details).toContain("db7.msp.internal");
        expect(JSON.stringify(log)).toContain("Scope: databases only");
        expect(vi.mocked(notify).mock.calls[0][0].data).toEqual(expect.objectContaining({ backupFile: "2026-10-15_0214_nightly.tar", storageName: "MSP NAS" }));
        expect(runTarget()).toEqual({ id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql" });
    });
});

describe("the run of the tenant of the server beside a customer's restore", () => {
    it("reads every line in full, the archive, the scope and the command, while the customer's run stays as it was", async () => {
        wire(mysqlLike);
        await runRestorePipeline("run-1", SHARED, PROVIDER_RUN);

        const full = runLog("msp-run");
        const messages = full.map((entry) => entry.message);
        expect(messages).toEqual(expect.arrayContaining([
            `Starting restore of shop_acme for Acme out of 2026-10-15_0214_nightly.tar`,
            `Reading backup metadata: ${ARCHIVE}...`,
            "Archive contains 2 database(s) and 0 directory source(s).",
            "Scope: databases only - the archive's directory sources are left untouched.",
            "Server settings: max_allowed_packet=67108864 innodb_buffer_pool_size=134217728",
            "MySQL: Warning: lost the connection to db7.msp.internal:3306 for a moment",
            "Database restored: shop_acme",
        ]));
        expect(full.find((entry) => entry.message === "Restoring to database: shop_acme")?.details).toContain("db7.msp.internal");
        expectNothingOfTheServer(JSON.stringify(runLog()));

        // Both end the same way, and the provider's run knows the connection and the customer's run.
        expect(lastOf("run-1", "status")).toBe("Success");
        expect(lastOf("msp-run", "status")).toBe("Success");
        expect(runMetadata("msp-run")).toEqual(expect.objectContaining({
            target: { id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql" },
            restoreOf: { database: "shop_acme", customer: "Acme" },
            followsRun: "run-1",
        }));
        expect(runMetadata()).toEqual(expect.objectContaining({ target: { name: "Shared MySQL", adapterId: "mysql" }, restoreOf: { database: "shop_acme" } }));
    });

    it("keeps the error of the server whole, and the customer's failed run points to it", async () => {
        wire(async () => {
            throw new Error("ERROR 1045 (28000): Access denied for user 'dbackup'@'10.20.0.9' on db7.msp.internal:3306");
        });
        await runRestorePipeline("run-1", SHARED, PROVIDER_RUN);

        expect(runLog("msp-run").map((entry) => entry.message)).toContain(
            "Failed to restore database 'shop_acme': ERROR 1045 (28000): Access denied for user 'dbackup'@'10.20.0.9' on db7.msp.internal:3306"
        );
        expect(runLog().map((entry) => entry.message)).toContain("Skyfay Hosting sees the full run in its History.");
        expect(runLog("msp-run").map((entry) => entry.message)).not.toContain("Skyfay Hosting sees the full run in its History.");
        expectNothingOfTheServer(JSON.stringify(runLog()));
        expect(lastOf("run-1", "status")).toBe("Failed");
        expect(lastOf("msp-run", "status")).toBe("Failed");
    });

    it("ends on the whole error when the destination does not answer", async () => {
        wire(mysqlLike, { archiveAnswers: false });
        await runRestorePipeline("run-1", SHARED, PROVIDER_RUN);

        expect(runLog("msp-run").map((entry) => entry.message)).toContain(`Fatal Error: Failed to download archive '${ARCHIVE}' from msp-fs`);
        expect(runLog().map((entry) => entry.message)).toEqual(expect.arrayContaining([
            "Fatal Error: The restore of shop_acme stopped with an error.",
            "Skyfay Hosting sees the full run in its History.",
        ]));
        expectNothingOfTheServer(JSON.stringify(runLog()));
        expect(lastOf("msp-run", "status")).toBe("Failed");
    });

    it("stops with Cancel in either History", async () => {
        wire(mysqlLike);
        await runRestorePipeline("run-1", SHARED, PROVIDER_RUN);

        const controller = vi.mocked(registerExecution).mock.results[0].value;
        expect(vi.mocked(registerExecution).mock.calls).toEqual([["run-1"], ["msp-run", controller]]);
        expect(vi.mocked(unregisterExecution).mock.calls).toEqual([["run-1"], ["msp-run"]]);
    });
});
