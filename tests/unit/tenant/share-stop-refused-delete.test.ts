// @vitest-environment node
/**
 * Stopping to share a destination when the storage answers the listing but refuses the deletes, the
 * way most storage adapters report a failed delete: they return false instead of throwing. A delete
 * that did not happen is no delete, so the share stays with nobody on it and the tenant of the
 * destination never sees the files of its customers.
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
const storage = vi.hoisted(() => ({ files: new Map<string, number>(), failOn: null as string | null, goneAnyway: false }));
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
            // Like local, SFTP, FTP, SMB, WebDAV and the cloud drives: a refused delete answers false.
            if (storage.failOn && file.startsWith(storage.failOn)) {
                // Like a file that retention took away a moment before: the delete fails, the file is gone.
                if (storage.goneAnyway) storage.files.delete(file);
                return false;
            }
            return storage.files.delete(file);
        },
    } as unknown as StorageAdapter;
    return { ...original, openRow: async (_row: unknown, mode: StorageViewMode) => ({ adapter: storageView(adapter, mode), config: {} }) };
});

let root = "";
let base: PrismaClient;

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-share-refused-"));
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
    storage.goneAnyway = false;
    storage.files = new Map([
        ["acme-job/one.tar", 10],
        ["tenants/globex/globex-nightly/two.tar", 20],
        ["tenants/hooli/old/five.tar", 50],
    ]);
});

const stop = () => runAsTenant("acme", () => connectionShareService.save("acme-nas", { allTenants: false, tenantIds: [], encryptedOnly: false, ownRecipients: true }, { confirmed: true }));

describe("stopping to share a destination whose storage refuses a delete", () => {
    it("keeps the share with nobody on it while a file of a customer is left in its folder", async () => {
        storage.failOn = "tenants/hooli/";
        const failed = await stop().catch((error: unknown) => error);

        expect(storage.files.has("tenants/hooli/old/five.tar")).toBe(true);
        // Acme must not see the folder of its customers, which still holds a backup of Hooli.
        expect((await destinationAccess({ id: "acme-nas", tenantId: "acme" }, "acme")).mode).toEqual({ kind: "provider" });
        expect(failed).toBeInstanceOf(ShareChangeError);
    });

    it("keeps the destination for a tenant whose backups there could not be deleted", async () => {
        storage.failOn = "tenants/globex/";
        await stop().catch(() => undefined);

        expect(storage.files.has("tenants/globex/globex-nightly/two.tar")).toBe(true);
        // Globex keeps it as it was, like when the storage does not answer at all.
        expect((await providedTo("globex")).map((connection) => connection.id)).toEqual(["acme-nas"]);
    });
});

describe("deleting the backups of a customer on a shared destination whose storage refuses a delete", () => {
    it("does not report the backups as deleted", async () => {
        storage.failOn = "tenants/globex/";
        const result = await runAsTenant("acme", () => connectionShareService.deleteBackupsOf("acme-nas", "globex")).catch((error: unknown) => error);

        expect(storage.files.has("tenants/globex/globex-nightly/two.tar")).toBe(true);
        expect(result).toBeInstanceOf(Error);
    });
});

describe("deleting the backups of a customer whose delete answered false for a file that is gone anyway", () => {
    it("counts the file as deleted, since a second listing no longer finds it", async () => {
        storage.failOn = "tenants/globex/";
        storage.goneAnyway = true;
        const result = await runAsTenant("acme", () => connectionShareService.deleteBackupsOf("acme-nas", "globex"));

        expect(result).toMatchObject({ backups: 1 });
        expect(storage.files.has("tenants/globex/globex-nightly/two.tar")).toBe(false);
    });
});
