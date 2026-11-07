// @vitest-environment node
/**
 * The customers `pnpm lab:seed` adds beside the home tenant, against a real SQLite database
 * migrated with the migrations of this version: Acme with a person, a database of a lab server, a
 * destination and a channel of the home tenant and a job of its own, Globex with the local network
 * blocked, and a platform group of both. A second run changes nothing. Better Auth and the storage
 * are replaced, the services of the app run as they are.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import type { StorageViewMode } from "@/lib/tenant/storage-view";
import type { LabConfig } from "../../../lab/src/config";

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

// Better Auth hashes the password and keeps the account. Here the account alone is the subject.
vi.mock("@/services/auth/auth-service", () => ({
    authService: {
        createUser: vi.fn(async (data: { name: string; email: string }) => {
            const client = app.client as PrismaClient;
            const user = await client.user.create({ data: { id: `user-${data.email}`, name: data.name, email: data.email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() } });
            return { user };
        }),
    },
}));

// The numbers of the storage are not the subject here.
vi.mock("@/services/dashboard-service", () => ({
    storageEntriesOf: vi.fn(async () => []),
    refreshStorageStatsCache: vi.fn(async () => undefined),
}));

// The shared destination is empty, as on a new lab.
vi.mock("@/services/sharing/destination-access", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/services/sharing/destination-access")>();
    const { storageView } = await import("@/lib/tenant/storage-view");
    const adapter = { id: "memory", type: "storage", name: "Memory", list: async (): Promise<FileInfo[]> => [], delete: async () => true } as unknown as StorageAdapter;
    return { ...original, openRow: async (_row: unknown, mode: StorageViewMode) => ({ adapter: storageView(adapter, mode), config: {} }) };
});

const { runAsSystem, runAsTenant } = await import("@/lib/tenant/context");
const { tenantScopeExtension } = await import("@/lib/tenant/prisma-scope");
const { HOME_TENANT_ID } = await import("@/lib/tenant/home");
const { ensureConnection } = await import("../../../lab/src/seed/records");
const { engineOf } = await import("../../../lab/src/engines");
const { seedTenants } = await import("../../../lab/src/seed/tenants");
const { customerRows, readCustomers } = await import("../../../lab/src/status-checks");
const { ACME_SERVER, LAB_SUPPORT, LAB_TENANTS } = await import("../../../lab/src/tenants");
type SeededConnections = import("../../../lab/src/seed/connections").SeededConnections;
type CustomerReader = import("../../../lab/src/status-checks").CustomerReader;

const CONFIG = {
    admin: { name: "Dev", email: "dev@lab.test", password: "Quartz-Lantern-7419" },
    docker: { name: "lab", docker: "lab", address: "192.0.2.10" },
    profile: "core",
    natives: [],
} as unknown as LabConfig;

let root = "";
let base: PrismaClient;
let connections: SeededConnections;
let firstRun: string[] = [];

const db = () => app.client as PrismaClient;
const tenantId = async (name: string) => (await db().tenant.findUniqueOrThrow({ where: { name } })).id;

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-lab-tenants-"));
    const file = path.join(root, "lab.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => null));

    // What the seed of the home tenant made before: a lab server, the Local destination and the mail channel.
    connections = await runAsTenant(HOME_TENANT_ID, async () => ({
        sources: new Map([["postgres-18", (await ensureConnection({ name: "Lab PostgreSQL 18", type: "database", adapterId: "postgres", config: engineOf("postgres").source({ host: "192.0.2.10", port: 54418 }, CONFIG) })).id]]),
        destinations: new Map([["local", (await ensureConnection({ name: "Lab Local", type: "storage", adapterId: "local-filesystem", config: { basePath: path.join(root, "backups") } })).id]]),
        channels: new Map([["mail", (await ensureConnection({ name: "Lab Mail", type: "notification", adapterId: "email", config: { host: "192.0.2.10", port: 1025, secure: "none", from: "lab@dbackup.lab", to: ["dev@lab.test"] } })).id]]),
        log: [],
    }));
    firstRun = await runAsTenant(HOME_TENANT_ID, () => seedTenants(CONFIG, connections));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("the customers of the dev lab seed", () => {
    it("makes Acme and Globex with a person each, Admin in their tenant", async () => {
        for (const tenant of Object.values(LAB_TENANTS)) {
            const id = await tenantId(tenant.name);
            const user = await db().user.findUniqueOrThrow({ where: { email: tenant.person.email }, include: { memberships: { include: { group: true } } } });
            expect(user.memberships.map((membership) => [membership.tenantId, membership.group.fullAccess])).toEqual([[id, true]]);
        }
    });

    it("lets Acme reach the Docker host of the lab alone and blocks the local network for Globex", async () => {
        const acme = await db().tenant.findUniqueOrThrow({ where: { name: LAB_TENANTS.acme.name } });
        const globex = await db().tenant.findUniqueOrThrow({ where: { name: LAB_TENANTS.globex.name } });
        expect([acme.blocksLocalNetwork, JSON.parse(acme.allowedNetworks)]).toEqual([true, ["192.0.2.10/32"]]);
        expect([globex.blocksLocalNetwork, JSON.parse(globex.allowedNetworks)]).toEqual([true, []]);
    });

    it("puts a person of the MSP into a platform group of the two customers, never of the home tenant", async () => {
        const group = await db().platformGroup.findUniqueOrThrow({ where: { name: LAB_SUPPORT.group }, include: { members: true, tenants: true } });
        expect(group.allTenants).toBe(false);
        expect(group.tenants.map((tenant) => tenant.tenantId).sort()).toEqual([await tenantId(LAB_TENANTS.acme.name), await tenantId(LAB_TENANTS.globex.name)].sort());
        expect(group.members.map((member) => member.email)).toEqual([LAB_SUPPORT.person.email]);
        expect(JSON.parse(group.platformPermissions)).toContain("platform-tenants:write");
        expect(JSON.parse(group.tenantPermissions)).not.toContain("settings:write");
        const person = await db().user.findUniqueOrThrow({ where: { email: LAB_SUPPORT.person.email }, include: { memberships: true } });
        expect([person.platformRole, person.memberships]).toEqual([null, []]);
    });

    it("gives Acme one database of a lab server and shares the Local destination and the mail channel with it", async () => {
        const acme = await tenantId(LAB_TENANTS.acme.name);
        const assignments = await runAsSystem(() => db().databaseAssignment.findMany({ where: { validUntil: null } }));
        expect(assignments.map((assignment) => [assignment.sourceId, assignment.databaseName, assignment.tenantId])).toEqual([[connections.sources.get("postgres-18"), "shop", acme]]);
        const shares = await runAsSystem(() => db().connectionShare.findMany({ include: { tenants: true }, orderBy: { id: "asc" } }));
        expect(shares.map((share) => [share.id, share.allTenants, share.tenants.map((tenant) => tenant.tenantId)]).sort()).toEqual([
            [connections.destinations.get("local"), false, [acme]],
            [connections.channels.get("mail"), false, [acme]],
        ].sort());
        const recipients = await runAsSystem(() => db().channelRecipients.findMany());
        expect(recipients.map((row) => [row.tenantId, JSON.parse(row.recipients)])).toEqual([[acme, [LAB_TENANTS.acme.person.email]]]);
    });

    it("gives Acme a job of its own server to the shared destination, encrypted with its key and heard through the shared channel", async () => {
        const acme = await tenantId(LAB_TENANTS.acme.name);
        const job = await runAsTenant(acme, () => db().job.findFirstOrThrow({
            where: { name: ACME_SERVER.job },
            include: { source: true, destinations: true, encryptionProfile: true, notificationTemplates: { include: { template: { include: { channels: true } } } } },
        }));
        expect(job.enabled).toBe(false);
        expect([job.source?.name, job.source?.tenantId]).toEqual([ACME_SERVER.connection, acme]);
        expect(job.destinations.map((destination) => destination.configId)).toEqual([connections.destinations.get("local")]);
        expect([job.encryptionProfile?.name, job.encryptionProfile?.tenantId]).toEqual([ACME_SERVER.key, acme]);
        expect(job.notificationTemplates.flatMap((link) => link.template.channels.map((channel) => channel.configId))).toEqual([connections.channels.get("mail")]);
    });

    it("changes nothing on a second run", async () => {
        const tables = ["tenant", "user", "tenantMembership", "platformGroup", "platformGroupTenant", "connectionShareTenant", "channelRecipients", "databaseAssignment", "job", "adapterConfig", "credentialProfile", "encryptionProfile", "notificationTemplate"] as const;
        const snapshot = () => runAsSystem(async () => Promise.all(tables.map(async (table) => JSON.stringify(await (db()[table] as unknown as { findMany(args?: object): Promise<unknown[]> }).findMany()))));
        const before = await snapshot();
        await expect(runAsTenant(HOME_TENANT_ID, () => seedTenants(CONFIG, connections))).resolves.toEqual([`kept ${LAB_TENANTS.acme.name}, ${LAB_TENANTS.globex.name} and ${LAB_SUPPORT.group}`]);
        // The connection and login of Acme are brought up to date like every connection of the seed, with the same values.
        const after = await snapshot();
        tables.forEach((table, index) => {
            if (table === "adapterConfig" || table === "credentialProfile") return;
            expect(after[index], table).toBe(before[index]);
        });
        expect(firstRun.length).toBeGreaterThan(1);
    });

    it("keeps what was changed by hand, like the network of a customer and the recipients it names", async () => {
        const acme = await tenantId(LAB_TENANTS.acme.name);
        const channel = connections.channels.get("mail")!;
        await db().tenant.update({ where: { id: acme }, data: { blocksLocalNetwork: false, allowedNetworks: "[]" } });
        await runAsTenant(acme, () => db().channelRecipients.updateMany({ data: { recipients: JSON.stringify(["ops@acme.test"]) } }));

        await runAsTenant(HOME_TENANT_ID, () => seedTenants(CONFIG, connections));

        expect((await db().tenant.findUniqueOrThrow({ where: { id: acme } })).blocksLocalNetwork).toBe(false);
        const recipients = await runAsTenant(acme, () => db().channelRecipients.findFirstOrThrow({ where: { configId: channel } }));
        expect(JSON.parse(recipients.recipients)).toEqual(["ops@acme.test"]);
        await db().tenant.update({ where: { id: acme }, data: { blocksLocalNetwork: true, allowedNetworks: JSON.stringify(["192.0.2.10/32"]) } });
    });

    it("shows in lab:status as in place", async () => {
        const { rows, next } = customerRows(await runAsSystem(() => readCustomers(db() as unknown as CustomerReader)));
        expect(next).toEqual([]);
        expect(rows.map((row) => [row.mark, row.name])).toEqual([["ok", "Acme"], ["ok", "Globex"], ["ok", "Lab Support"], ["info", "people"]]);
        expect(rows[0].detail).toBe("acme@dbackup.lab, 1 job, shop given to it, 2 connections shared with it, blocks the local network but 1 range");
        expect(rows[1].detail).toBe("globex@dbackup.lab, blocks the local network");
    });
});
