// @vitest-environment node
/**
 * Sharing a destination or a channel for someone of a platform group of some tenants, against a
 * real SQLite database migrated with the migrations of this version: they share with and take from
 * the tenants their platform group reaches, the tenants beyond it keep what they get, and every
 * tenant at once is for a reach of every tenant. The storage is a map in memory.
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
import type { PlatformReach } from "@/lib/tenant/sharing-reach";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { connectionShareService, type ShareSettings } from "@/services/sharing/connection-shares";
import { providedTo } from "@/services/sharing/provided";

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
// The numbers of the storage are not the subject here.
vi.mock("@/services/dashboard-service", () => ({
    storageEntriesOf: vi.fn(async () => []),
    refreshStorageStatsCache: vi.fn(async () => undefined),
}));

/** The files of the destination `acme-nas`, by their path from its root. */
const storage = vi.hoisted(() => ({ files: new Map<string, number>() }));
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
        delete: async (_config: unknown, file: string) => storage.files.delete(file),
    } as unknown as StorageAdapter;
    return { ...original, openRow: async (_row: unknown, mode: StorageViewMode) => ({ adapter: storageView(adapter, mode), config: {} }) };
});

let root = "";
let base: PrismaClient;

/** The service desk of Globex: its platform group reaches the MSP and Globex. */
const DESK: PlatformReach = ["acme", "globex"];

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-reach-shares-"));
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

/** Acme is the MSP, Globex, Initech and Umbrella its customers. */
beforeEach(async () => {
    for (const model of ["connectionShareTenant", "connectionShare", "channelRecipients", "storageListCache", "jobDestination", "job", "adapterConfig", "tenant"] as const) {
        await (base[model] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({ where: model === "tenant" ? { id: { not: "default" } } : {} });
    }
    await base.tenant.create({ data: { id: "acme", name: "Acme Hosting", sharesWithCustomers: true } });
    for (const [id, name] of [["globex", "Globex"], ["initech", "Initech"], ["umbrella", "Umbrella"]]) await base.tenant.create({ data: { id, name } });
    await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-nas", name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-mail", name: "Mail", type: "notification", adapterId: "email", config: "{}" } });
    // The folder of the customers is empty before the first share, their backups come after it.
    storage.files = new Map([["acme-job/one.tar", 10]]);
});

/** What the customers wrote once the destination was shared with them. */
const customerBackups = () => {
    storage.files.set("tenants/globex/nightly/two.tar", 20);
    storage.files.set("tenants/initech/nightly/three.tar", 30);
};

const settingsOf = (tenantIds: string[], terms: Partial<ShareSettings> = {}): ShareSettings => ({ allTenants: false, encryptedOnly: false, ownRecipients: true, ...terms, tenantIds });
/** A change as someone with the reach makes it in the tenant of the MSP. */
const share = (configId: string, settings: ShareSettings, reach: PlatformReach = "all", confirmed = true) =>
    runAsTenant("acme", () => connectionShareService.save(configId, settings, { confirmed, reach }));
const providedIdsOf = async (tenantId: string) => (await providedTo(tenantId)).map((connection) => connection.id);
const customersOf = async (configId: string) => (await base.connectionShareTenant.findMany({ where: { shareId: configId }, orderBy: { tenantId: "asc" } })).map((row) => row.tenantId);

describe("sharing in a platform group of some tenants", () => {
    it("offers only the tenants it reaches, and names those beyond it that get the connection already", async () => {
        await share("acme-nas", settingsOf(["globex", "initech"]));
        const view = await runAsTenant("acme", () => connectionShareService.view("acme-nas", DESK));

        expect(view.candidates.map((tenant) => tenant.id)).toEqual(["globex"]);
        expect(view.uses.map((use) => use.tenantId).sort()).toEqual(["globex", "initech"]);
        expect(view.reach).toEqual({
            outside: [{ id: "initech", name: "Initech" }],
            allTenants: "Your platform group does not reach every tenant, so you cannot share with all tenants.",
            terms: "The terms hold for Initech too, which your platform group does not reach, so you cannot change them.",
        });
    });

    it("shares with a tenant it reaches, and the tenants beyond its reach keep the connection as they had it", async () => {
        await share("acme-mail", settingsOf(["initech"]));
        // The dialog ticks only Globex, the tenants beyond the reach are not its to untick.
        await share("acme-mail", settingsOf(["globex"]), DESK);

        expect(await customersOf("acme-mail")).toEqual(["globex", "initech"]);
        expect(await providedIdsOf("initech")).toEqual(["acme-mail"]);
    });

    it("cannot share with a tenant it does not reach", async () => {
        await expect(share("acme-mail", settingsOf(["globex", "umbrella"]), DESK))
            .rejects.toThrow("Your platform group does not reach Umbrella, so you cannot share with it or stop sharing with it.");
        expect(await base.connectionShare.count()).toBe(0);
    });

    it("cannot share with every tenant, nor change or stop a share with every tenant", async () => {
        await expect(share("acme-nas", { ...settingsOf([]), allTenants: true }, DESK)).rejects.toThrow("so you cannot share with all tenants");

        await share("acme-mail", { ...settingsOf([]), allTenants: true });
        await expect(share("acme-mail", settingsOf(["globex"]), DESK))
            .rejects.toThrow("Mail is shared with every tenant. Only someone whose platform group reaches every tenant changes that.");
        await expect(runAsTenant("acme", () => connectionShareService.stopFor("acme-mail", "globex", { reach: DESK }))).rejects.toThrow("Mail is shared with every tenant");

        expect(await base.connectionShare.findUnique({ where: { id: "acme-mail" } })).toMatchObject({ allTenants: true });
        expect(await providedIdsOf("umbrella")).toEqual(["acme-mail"]);
    });

    it("cannot stop sharing with a tenant it does not reach, nor delete its backups there", async () => {
        await share("acme-nas", settingsOf(["globex", "initech"]));
        customerBackups();

        await expect(runAsTenant("acme", () => connectionShareService.stopFor("acme-nas", "initech", { confirmed: true, reach: DESK }))).rejects.toThrow("does not reach Initech");
        await expect(runAsTenant("acme", () => connectionShareService.deleteBackupsOf("acme-nas", "initech", DESK)))
            .rejects.toThrow("Your platform group does not reach Initech, so you cannot delete its backups.");
        // Stopping with nobody ticked takes it from the tenants it reaches alone.
        await share("acme-nas", settingsOf([]), DESK);

        expect(await customersOf("acme-nas")).toEqual(["initech"]);
        expect([...storage.files.keys()].sort()).toEqual(["acme-job/one.tar", "tenants/initech/nightly/three.tar"]);
    });

    it("lists only the tenants it reaches among those that would lose the connection", async () => {
        await share("acme-nas", settingsOf(["globex", "initech"]));
        const losing = await runAsTenant("acme", () => connectionShareService.losing("acme-nas", { allTenants: false, tenantIds: [] }, DESK));
        expect(losing.map((use) => use.tenantId)).toEqual(["globex"]);
    });

    it("changes no terms that hold for a tenant beyond its reach", async () => {
        await share("acme-nas", settingsOf(["initech"]));
        await expect(share("acme-nas", settingsOf(["globex", "initech"], { encryptedOnly: true }), DESK))
            .rejects.toThrow("The terms hold for Initech too");
        expect(await base.connectionShare.findUnique({ where: { id: "acme-nas" } })).toMatchObject({ encryptedOnly: false });

        // The terms of a share it reaches alone are its own to change.
        await share("acme-mail", settingsOf(["globex"]), DESK);
        await share("acme-mail", settingsOf(["globex"], { ownRecipients: false }), DESK);
        expect(await base.connectionShare.findUnique({ where: { id: "acme-mail" } })).toMatchObject({ ownRecipients: false });
    });

    it("keeps every tenant for a platform admin and a platform group of all tenants", async () => {
        await share("acme-nas", settingsOf(["globex", "initech"]));
        const view = await runAsTenant("acme", () => connectionShareService.view("acme-nas", "all"));
        expect(view.candidates.map((tenant) => tenant.id).sort()).toEqual(["default", "globex", "initech", "umbrella"]);
        expect(view.reach).toEqual({ outside: [], allTenants: null, terms: null });

        await runAsTenant("acme", () => connectionShareService.stopFor("acme-nas", "initech", { confirmed: true, reach: "all" }));
        await share("acme-mail", { ...settingsOf([]), allTenants: true });
        expect(await customersOf("acme-nas")).toEqual(["globex"]);
        expect(await providedIdsOf("umbrella")).toEqual(["acme-mail"]);
    });
});
