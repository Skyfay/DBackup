// @vitest-environment node
/**
 * Sharing a destination or a notification channel with other tenants, against a real SQLite
 * database migrated with the migrations of this version: who gets a connection, what a customer
 * loses when the tenant that shares it takes it back, and where a message through a shared channel
 * goes. The storage is a map in memory, so a test sees which files a stop deletes.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";
import { storageView, type StorageViewMode } from "@/lib/tenant/storage-view";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { connectionShareService } from "@/services/sharing/connection-shares";
import { providedTo } from "@/services/sharing/provided";
import { channelTarget, setRecipients } from "@/services/sharing/channel-recipients";

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
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-shares-"));
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

/** Acme is the MSP, Globex and Initech its customers, each with a job. */
beforeEach(async () => {
    for (const model of ["connectionShareTenant", "connectionShare", "channelRecipients", "storageListCache", "jobNotificationTemplate", "notificationTemplateChannel", "notificationTemplate", "jobDestination", "execution", "job", "adapterConfig", "tenant"] as const) {
        await (base[model] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({ where: model === "tenant" ? { id: { not: "default" } } : {} });
    }
    await base.tenant.create({ data: { id: "acme", name: "Acme Hosting", sharesWithCustomers: true } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    await base.tenant.create({ data: { id: "initech", name: "Initech" } });
    await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-nas", name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-mail", name: "Mail", type: "notification", adapterId: "email", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-chat", name: "Chat", type: "notification", adapterId: "discord", config: "{}" } });
    for (const tenantId of ["globex", "initech"]) {
        await base.adapterConfig.create({ data: { tenantId, id: `${tenantId}-db`, name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
        await base.job.create({ data: { tenantId, id: `${tenantId}-job`, name: `${tenantId} nightly`, schedule: "0 3 * * *", sourceId: `${tenantId}-db` } });
    }
    storage.failOn = null;
    storage.files = new Map([
        ["acme-job/one.tar", 10],
        ["tenants/globex/globex-nightly/two.tar", 20],
        ["tenants/globex/globex-nightly/two.tar.meta.json", 1],
        ["tenants/initech/initech-nightly/three.tar", 30],
    ]);
});

const share = (configId: string, tenantIds: string[], terms: Partial<{ allTenants: boolean; encryptedOnly: boolean; ownRecipients: boolean }> = {}, confirmed = false) =>
    runAsTenant("acme", () => connectionShareService.save(configId, { allTenants: false, encryptedOnly: false, ownRecipients: true, ...terms, tenantIds }, { confirmed }));

const providedIdsOf = async (tenantId: string) => (await providedTo(tenantId)).map((connection) => connection.id);

describe("sharing a connection with other tenants", () => {
    it("is for a tenant that shares with customers only", async () => {
        await base.tenant.update({ where: { id: "acme" }, data: { sharesWithCustomers: false } });
        await expect(share("acme-nas", ["globex"])).rejects.toThrow("shares nothing with customers");
        expect(await base.connectionShare.count()).toBe(0);
    });

    it("gives a destination to the picked tenants and to nobody else", async () => {
        await share("acme-nas", ["globex"], { encryptedOnly: true });
        const [provided] = await providedTo("globex");
        expect(provided).toMatchObject({ id: "acme-nas", providerName: "Acme Hosting", encryptedOnly: true });
        expect(await providedIdsOf("initech")).toEqual([]);
        // The tenant that shares it does not get it a second time.
        expect(await providedIdsOf("acme")).toEqual([]);
    });

    it("gives a connection shared with every tenant to a tenant created later too", async () => {
        await share("acme-mail", [], { allTenants: true });
        await base.tenant.create({ data: { id: "hooli", name: "Hooli" } });
        expect(await providedIdsOf("hooli")).toEqual(["acme-mail"]);
    });

    it("gives nothing once the tenant shares with customers no longer", async () => {
        await share("acme-nas", ["globex"]);
        await base.tenant.update({ where: { id: "acme" }, data: { sharesWithCustomers: false } });
        expect(await providedIdsOf("globex")).toEqual([]);
    });

    it("refuses a destination while a job of its tenant is called like the folder of the customers", async () => {
        await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-db", name: "Own", type: "database", adapterId: "mysql", config: "{}" } });
        await base.job.create({ data: { tenantId: "acme", id: "acme-tenants", name: "tenants", schedule: "0 3 * * *", sourceId: "acme-db", destinations: { create: { configId: "acme-nas" } } } });
        await expect(share("acme-nas", ["globex"])).rejects.toThrow("is called tenants");
    });

    it("refuses a tenant that does not exist", async () => {
        await expect(share("acme-nas", ["nobody"])).rejects.toThrow("no longer exists");
    });

    it("keeps only the terms that fit the kind of connection", async () => {
        await share("acme-chat", ["globex"], { encryptedOnly: true, ownRecipients: true });
        expect(await base.connectionShare.findUnique({ where: { id: "acme-chat" } })).toMatchObject({ encryptedOnly: false, ownRecipients: false });
    });
});

describe("taking a destination back", () => {
    beforeEach(async () => {
        await share("acme-nas", ["globex", "initech"]);
        await base.jobDestination.create({ data: { id: "globex-link", jobId: "globex-job", configId: "acme-nas" } });
        await base.storageListCache.create({ data: { adapterConfigId: "acme-nas", tenantId: "globex", filesJson: "{}" } });
    });

    it("needs a confirmation, since the tenant loses its backups there", async () => {
        await expect(share("acme-nas", ["initech"])).rejects.toThrow("Confirm it first");
        expect(storage.files.has("tenants/globex/globex-nightly/two.tar")).toBe(true);
        expect(await providedIdsOf("globex")).toEqual(["acme-nas"]);
    });

    it("deletes the backups of that tenant alone, its links to the destination and its listing", async () => {
        const result = await share("acme-nas", ["initech"], {}, true);

        expect(result.losses).toEqual([{ tenantId: "globex", name: "Globex", jobs: ["globex nightly"], templates: [], backups: 1 }]);
        expect([...storage.files.keys()].sort()).toEqual(["acme-job/one.tar", "tenants/initech/initech-nightly/three.tar"]);
        expect(await base.jobDestination.count({ where: { id: "globex-link" } })).toBe(0);
        expect(await base.storageListCache.count({ where: { tenantId: "globex" } })).toBe(0);
        expect(await providedIdsOf("globex")).toEqual([]);
        expect(await providedIdsOf("initech")).toEqual(["acme-nas"]);
    });

    it("is no longer shared once nobody gets it, and keeps nothing of a customer it lost earlier", async () => {
        // Left by a tenant that is gone, whose backups the storage did not take at the time.
        storage.files.set("tenants/hooli/old/five.tar", 50);
        await share("acme-nas", [], {}, true);
        expect(await base.connectionShare.count()).toBe(0);
        expect([...storage.files.keys()]).toEqual(["acme-job/one.tar"]);
    });

    it("waits while a run of the tenant that loses it writes to it", async () => {
        await base.execution.create({ data: { tenantId: "globex", id: "globex-run", jobId: "globex-job", status: "Running", logs: "[]" } });
        await expect(share("acme-nas", ["initech"], {}, true)).rejects.toThrow("A run of Globex writes to this destination right now");
        expect(storage.files.has("tenants/globex/globex-nightly/two.tar")).toBe(true);
        expect(await providedIdsOf("globex")).toEqual(["acme-nas"]);
    });

    it("takes it off the tenants that lost everything when the storage stops answering on the way", async () => {
        storage.failOn = "tenants/initech/";
        const failed = share("acme-nas", [], {}, true);
        await expect(failed).rejects.toThrow("Could not take it away from a tenant");
        const error = (await failed.catch((caught: unknown) => caught)) as { change?: { losses: { tenantId: string }[] } };
        // Globex lost its backups and its jobs, so it is off the share. Initech keeps it as it was.
        expect(error.change?.losses.map((loss) => loss.tenantId)).toEqual(["globex"]);
        expect(await providedIdsOf("globex")).toEqual([]);
        expect(await providedIdsOf("initech")).toEqual(["acme-nas"]);
        expect(storage.files.has("tenants/initech/initech-nightly/three.tar")).toBe(true);
    });

    it("stops for one tenant and keeps it for the others", async () => {
        await runAsTenant("acme", () => connectionShareService.stopFor("acme-nas", "initech", { confirmed: true }));
        expect(await providedIdsOf("globex")).toEqual(["acme-nas"]);
        expect(await providedIdsOf("initech")).toEqual([]);
        expect(storage.files.has("tenants/initech/initech-nightly/three.tar")).toBe(false);
    });

    it("lets the tenant that shares it delete the backups of a tenant that gets it, never of another one", async () => {
        const result = await runAsTenant("acme", () => connectionShareService.deleteBackupsOf("acme-nas", "globex"));
        expect(result).toEqual({ name: "NAS", tenantName: "Globex", backups: 1 });
        expect(await providedIdsOf("globex")).toEqual(["acme-nas"]);

        await share("acme-nas", ["globex"], {}, true);
        storage.files.set("tenants/initech/initech-nightly/four.tar", 40);
        await expect(runAsTenant("acme", () => connectionShareService.deleteBackupsOf("acme-nas", "initech"))).rejects.toThrow("does not get this destination");
        expect(storage.files.has("tenants/initech/initech-nightly/four.tar")).toBe(true);
        await expect(runAsTenant("acme", () => connectionShareService.deleteBackupsOf("acme-nas", "acme"))).rejects.toThrow("backups of this tenant");
    });

    it("is found only by the tenant it belongs to", async () => {
        await expect(runAsTenant("globex", () => connectionShareService.save("acme-nas", { allTenants: true, tenantIds: [], encryptedOnly: false, ownRecipients: false }, { confirmed: true })))
            .rejects.toThrow("not found");
        expect(await runAsSystem(() => base.connectionShare.findUnique({ where: { id: "acme-nas" } }))).toMatchObject({ allTenants: false });
    });
});

describe("taking a channel back", () => {
    it("sends an event that named it alone to the default channels again", async () => {
        await share("acme-mail", ["globex"]);
        const { saveTenantNotificationConfig, getTenantNotificationConfig } = await import("@/services/notifications/tenant-notification-settings");
        const before = await getTenantNotificationConfig("globex");
        const eventId = Object.keys(before.events)[0] ?? "BACKUP_FAILURE";
        await saveTenantNotificationConfig("globex", { globalChannels: ["acme-mail"], events: { ...before.events, [eventId]: { ...(before.events[eventId] ?? {}), channels: ["acme-mail"] } } } as never);

        await runAsTenant("acme", () => connectionShareService.stopFor("acme-mail", "globex"));

        const after = await getTenantNotificationConfig("globex");
        expect(after.globalChannels).toEqual([]);
        expect(after.events[eventId]?.channels ?? null).toBeNull();
    });

    it("takes it out of the templates, the jobs and the recipients of that tenant, which keep everything else", async () => {
        await share("acme-mail", ["globex"]);
        await base.notificationTemplate.create({ data: { tenantId: "globex", id: "globex-template", name: "Failures", channels: { create: { configId: "acme-mail", events: "FAILED" } }, jobs: { create: { jobId: "globex-job" } } } });
        await base.job.update({ where: { id: "globex-job" }, data: { notifications: { connect: { id: "acme-mail" } } } });
        await runAsTenant("globex", () => setRecipients("acme-mail", "globex", ["ops@globex.example"]));

        const result = await runAsTenant("acme", () => connectionShareService.stopFor("acme-mail", "globex"));

        expect(result.losses).toEqual([{ tenantId: "globex", name: "Globex", jobs: ["globex nightly"], templates: ["Failures"], backups: 0 }]);
        expect(await base.notificationTemplate.count({ where: { id: "globex-template" } })).toBe(1);
        expect(await base.notificationTemplateChannel.count({ where: { configId: "acme-mail" } })).toBe(0);
        expect(await base.job.count({ where: { notifications: { some: { id: "acme-mail" } } } })).toBe(0);
        expect(await base.channelRecipients.count()).toBe(0);
    });
});

describe("a message of a customer through a shared channel", () => {
    const mail = { id: "acme-mail", tenantId: "acme" };

    it("goes to the recipients the customer named", async () => {
        await share("acme-mail", ["globex"]);
        expect(await channelTarget(mail, "globex")).toEqual({ refusal: expect.stringContaining("No recipients") });
        await runAsTenant("globex", () => setRecipients("acme-mail", "globex", ["OPS@globex.example", "ops@globex.example"]));
        expect(await channelTarget(mail, "globex")).toEqual({ to: ["ops@globex.example"] });
    });

    it("goes where the channel is set when the tenant that shares it keeps the recipients", async () => {
        await share("acme-mail", ["globex"], { ownRecipients: false });
        expect(await channelTarget(mail, "globex")).toEqual({});
        await expect(runAsTenant("globex", () => setRecipients("acme-mail", "globex", ["ops@globex.example"]))).rejects.toThrow("decides who gets");
    });

    it("goes nowhere once the channel is no longer shared with the customer", async () => {
        await share("acme-mail", ["initech"]);
        expect(await channelTarget(mail, "globex")).toEqual({ refusal: expect.stringContaining("no longer shared") });
        await expect(runAsTenant("globex", () => setRecipients("acme-mail", "globex", ["ops@globex.example"]))).rejects.toThrow("not found");
    });

    it("goes where the channel is set for the tenant it belongs to", async () => {
        expect(await channelTarget(mail, "acme")).toEqual({});
    });
});
