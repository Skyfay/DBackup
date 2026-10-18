/**
 * A restore out of a seekable archive whose databases all fail ends as Failed without throwing,
 * which once left the channels without a word. It tells them like a restore that throws, and a
 * customer's restore of a shared database in words that name nothing of the server.
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
const serverRow = { id: "shared-mysql", type: "database", adapterId: "mysql", name: "Shared MySQL", config: JSON.stringify({ host: "db7.msp.internal", port: 3306 }) };
const ACCESS_DENIED = "ERROR 1045 (28000): Access denied for user 'dbackup'@'10.20.0.9' on db7.msp.internal:3306";

const OWN: RestoreInput = {
    storageConfigId: "msp-nas",
    file: ARCHIVE,
    scope: "databases",
    targetSourceId: "shared-mysql",
    databaseMapping: [{ originalName: "shop_acme", targetName: "shop_acme", selected: true }],
};
const SHARED: RestoreInput = { ...OWN, shared: { databaseName: "shop_acme" } };

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "restore-failure-"));
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "restore-failure-tmp-"));
    const dump = path.join(workDir, "shop_acme.sql");
    await fs.writeFile(dump, "-- dump of shop_acme");
    const entries: ArchiveSourceEntry[] = [{ kind: "database", dbName: "shop_acme", path: dump, format: "sql" }];
    const tarPath = path.join(workDir, ARCHIVE);
    await fs.mkdir(path.dirname(tarPath), { recursive: true });
    const { indexBytes } = await createArchive(entries, tarPath, { sourceType: "mysql" });
    await fs.writeFile(`${tarPath}.index`, indexBytes);
    await fs.writeFile(`${tarPath}.meta.json`, JSON.stringify({ version: 1, archive: { formatVersion: 2, indexFile: ".index", encrypted: false } }));

    const storage = {
        id: "msp-fs",
        read: async (_c: unknown, remote: string) => fs.readFile(path.join(workDir, remote), "utf-8").catch(() => null),
        download: async (_c: unknown, remote: string, local: string) => fs.copyFile(path.join(workDir, remote), local).then(() => true, () => false),
        downloadRange: async (_c: unknown, remote: string, start: number, end: number) =>
            end < start ? Readable.from([]) : createReadStream(path.join(workDir, remote), { start, end }),
    };
    // Every database of the restore fails, so the archive restore ends Failed without throwing.
    const database = {
        id: "mysql", type: "database",
        restoreOne: vi.fn(async () => { throw new Error(ACCESS_DENIED); }),
        test: vi.fn().mockResolvedValue({ success: true, version: "8.0.36" }),
    };
    prismaMock.execution.update.mockResolvedValue({} as never);
    prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) =>
        where.id === "msp-nas" ? storageRow : where.id === "shared-mysql" ? serverRow : null) as never);
    vi.mocked(registry.get).mockImplementation(((id: string) => (id === "msp-fs" ? storage : database)) as never);
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
});

/** The status the run was last written with. */
function lastStatus(): string | undefined {
    const calls = prismaMock.execution.update.mock.calls as unknown as [{ data: { status?: string } }][];
    return calls.map((call) => call[0].data.status).filter(Boolean).pop();
}

describe("a restore out of an archive whose databases all fail", () => {
    it("ends Failed and tells the channels why", async () => {
        await runRestorePipeline("run-1", OWN);

        expect(lastStatus()).toBe("Failed");
        expect(notify).toHaveBeenCalledTimes(1);
        const [event] = vi.mocked(notify).mock.calls[0];
        expect(event.eventType).toBe("restore_failure");
        expect(event.data).toEqual(expect.objectContaining({ sourceName: "Shared MySQL", backupFile: "2026-10-15_0214_nightly.tar", storageName: "MSP NAS", executionId: "run-1" }));
        expect((event.data as { error?: string }).error).toContain("Access denied");
    });

    it("tells a customer of a shared database in neutral words, without the server or the archive", async () => {
        await runRestorePipeline("run-1", SHARED);

        expect(lastStatus()).toBe("Failed");
        expect(notify).toHaveBeenCalledTimes(1);
        const [event] = vi.mocked(notify).mock.calls[0];
        expect(event.eventType).toBe("restore_failure");
        expect(event.data).toEqual(expect.objectContaining({ backupFile: "shop_acme", targetDatabase: "shop_acme", error: "The restore of shop_acme stopped with an error." }));
        expect(event.data).not.toHaveProperty("storageName");
        const text = JSON.stringify(event.data);
        for (const hidden of ["db7.msp.internal", "10.20.0.9", "dbackup", "nightly", "MSP NAS"]) expect(text).not.toContain(hidden);
    });
});
