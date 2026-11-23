// @vitest-environment node
/**
 * Stopping to share a destination, against a real SQLite database migrated with the migrations of
 * this version: the folder of the customers is emptied before the share goes, a storage that does
 * not answer keeps the share with nobody on it until the next save empties it, and a run of a tenant
 * that loses the destination holds the change back, also while it only waits.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";
import { storageView, type StorageViewMode } from "@/lib/tenant/storage-view";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { ShareChangeError, connectionShareService } from "@/services/sharing/connection-shares";
import { providedTo } from "@/services/sharing/provided";
import { destinationAccess } from "@/services/sharing/destination-access";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const app = vi.hoisted(() => ({ client: null as unknown as object }));
vi.mock("@/lib/prisma", () => ({
    default: new Proxy({}, {
        get: (_target, key) => {
            const value = Reflect.get(app.client, key);
            return typeof value === "function" ? value.bind(app.client) : value;
        },
    }),
}));
vi.mock("@/services/dashboard-service", () => ({
    storageEntriesOf: vi.fn(async () => []),
    refreshStorageStatsCache: vi.fn(async () => undefined),
}));

/** The files of the destination `acme-nas`, by their path from its root. */
const storage = vi.hoisted(() => ({ files: new Map<string, number>(), failOn: null as string | null }));
vi.mock("@/services/sharing/destination-access", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/services/sharing/destination-access")>();
    const adapter = {
        id: "memory",
        type: "storage",
        name: "Memory",
        list: async (_config: unknown, dir: string): Promise<FileInfo[]> =>
            [...storage.files.keys()]
                .filter((file) => !dir || file.startsWith(`${dir}/`))
                .map((file) => ({ name: file.split("/").at(-1)!, path: file, size: storage.files.get(file)!, lastModified: new Date() })),
        delete: async (_config: unknown, file: string) => {
            if (storage.failOn && file.startsWith(storage.failOn)) throw new Error("connect ECONNREFUSED 10.0.0.7:22");
            return storage.files.delete(file);
        },
    } as unknown as StorageAdapter;
    return { ...original, openRow: async (_row: unknown, mode: StorageViewMode) => ({ adapter: storageView(adapter, mode), config: {} }) };
});

let root = "";
let base: PrismaClient;

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-share-sweep-"));
    const file = path.join(root, "shares.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => null));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

/** Acme is the MSP and shares its NAS with Globex, which writes to it. Hooli left a backup there long ago. */
beforeEach(async () => {
    for (const model of ["connectionShareTenant", "connectionShare", "storageListCache", "jobDestination", "execution", "job", "adapterConfig", "tenant"] as const) {
        await (base[model] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({ where: model === "tenant" ? { id: { not: "default" } } : {} });
    }
    await base.tenant.create({ data: { id: "acme", name: "Acme Hosting", sharesWithCustomers: true } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-nas", name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId: "globex", id: "globex-db", name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
    await base.job.create({ data: { tenantId: "globex", id: "globex-job", name: "globex nightly", schedule: "0 3 * * *", sourceId: "globex-db", destinations: { create: { configId: "acme-nas" } } } });
    await base.connectionShare.create({ data: { id: "acme-nas", tenantId: "acme", tenants: { create: { tenantId: "globex" } } } });
    storage.failOn = null;
    storage.files = new Map([
        ["acme-job/one.tar", 10],
        ["tenants/globex/globex-nightly/two.tar", 20],
        ["tenants/hooli/old/five.tar", 50],
    ]);
});

const stop = () => runAsTenant("acme", () => connectionShareService.save("acme-nas", { allTenants: false, tenantIds: [], encryptedOnly: false, ownRecipients: true }, { confirmed: true }));

describe("stopping to share a destination with its last customer", () => {
    it("keeps the share with nobody on it while the folder of the customers cannot be emptied, and says so", async () => {
        storage.failOn = "tenants/hooli/";
        const failed = await stop().catch((error: unknown) => error);

        expect(failed).toBeInstanceOf(ShareChangeError);
        expect((failed as ShareChangeError).message).toContain("could not be deleted");
        // Globex lost the destination all the same, which the caller logs.
        expect((failed as ShareChangeError).change.losses.map((loss) => loss.tenantId)).toEqual(["globex"]);
        expect(await providedTo("globex")).toEqual([]);
        // The share stays, so Acme still sees the destination without the folder of its customers.
        expect(await base.connectionShare.findUnique({ where: { id: "acme-nas" }, include: { tenants: true } })).toMatchObject({ allTenants: false, tenants: [] });
        expect((await destinationAccess({ id: "acme-nas", tenantId: "acme" }, "acme")).mode).toEqual({ kind: "provider" });
        expect(storage.files.has("tenants/hooli/old/five.tar")).toBe(true);
    });

    it("empties the folder on the next save once the storage answers, and only then shares it no longer", async () => {
        storage.failOn = "tenants/hooli/";
        await stop().catch(() => undefined);
        storage.failOn = null;

        await stop();
        expect(await base.connectionShare.count({ where: { id: "acme-nas" } })).toBe(0);
        expect([...storage.files.keys()]).toEqual(["acme-job/one.tar"]);
        expect((await destinationAccess({ id: "acme-nas", tenantId: "acme" }, "acme")).mode).toEqual({ kind: "own" });
    });

    it("waits while a run of the tenant that loses it only waits to start, which would write there", async () => {
        await base.execution.create({ data: { tenantId: "globex", id: "globex-run", jobId: "globex-job", status: "Pending", logs: "[]" } });
        await expect(stop()).rejects.toThrow("A run of Globex writes to this destination right now or waits to");
        expect(storage.files.has("tenants/globex/globex-nightly/two.tar")).toBe(true);
        expect((await providedTo("globex")).map((connection) => connection.id)).toEqual(["acme-nas"]);
    });
});
