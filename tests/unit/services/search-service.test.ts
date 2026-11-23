import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import type { SearchScope } from "@/services/search/search-types";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { searchRecords } = await import("@/services/search/search-service");

const HOME = "default";

const NONE: SearchScope = { jobs: false, backups: false, runs: false, databases: false, connections: [], users: false, groups: false, apiKeys: false, templates: false, keys: false, credentials: false };
const ALL: SearchScope = { jobs: true, backups: true, runs: true, databases: true, connections: ["database", "storage", "notification"], users: true, groups: true, apiKeys: true, templates: true, keys: true, credentials: true };

/** The fields a query selected, to prove a secret never leaves the database. */
const selected = (mock: { mock: { calls: unknown[][] } }) => Object.keys((mock.mock.calls[0][0] as { select: object }).select);

describe("the search over the records of DBackup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const model of [prismaMock.job, prismaMock.adapterConfig, prismaMock.databaseListCache, prismaMock.execution, prismaMock.user, prismaMock.group, prismaMock.apiKey, prismaMock.retentionPolicy, prismaMock.namingTemplate, prismaMock.schedulePreset, prismaMock.notificationTemplate, prismaMock.excludePatternPreset, prismaMock.encryptionProfile, prismaMock.credentialProfile]) {
            model.findMany.mockResolvedValue([] as never);
        }
    });

    it("asks nothing for a single letter", async () => {
        expect(await searchRecords("m", ALL, HOME)).toEqual([]);
        expect(prismaMock.job.findMany).not.toHaveBeenCalled();
    });

    it("finds jobs by name with the schedule they follow and how their last finished run went", async () => {
        prismaMock.job.findMany.mockResolvedValue([
            { id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", schedulePreset: null, source: { adapterId: "mysql" } },
            { id: "j2", name: "MySQL weekly", enabled: false, schedule: "0 3 * * 0", schedulePreset: { schedule: "0 4 * * 0" }, source: null },
        ] as never);
        prismaMock.execution.findFirst.mockResolvedValueOnce({ status: "Failed" } as never).mockResolvedValueOnce(null);

        const hits = await searchRecords(" mysql ", { ...NONE, jobs: true }, HOME);

        expect(prismaMock.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { name: { contains: "mysql" } } }));
        expect(prismaMock.execution.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "j1", status: { in: ["Success", "Failed", "Partial"] } } }));
        expect(hits).toEqual([
            { kind: "job", id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", adapterId: "mysql", lastStatus: "Failed" },
            { kind: "job", id: "j2", name: "MySQL weekly", enabled: false, schedule: "0 4 * * 0", adapterId: null, lastStatus: null },
        ]);
    });

    it("finds the backups of a job for someone who may see backups but not jobs, without their runs", async () => {
        prismaMock.job.findMany.mockResolvedValue([{ id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", schedulePreset: null, source: null }] as never);

        const hits = await searchRecords("nightly", { ...NONE, backups: true }, HOME);

        expect(hits).toEqual([{ kind: "backups", jobId: "j1", name: "Nightly MySQL" }]);
        expect(prismaMock.execution.findFirst).not.toHaveBeenCalled();
    });

    it("finds only the connections of the types the viewer may see", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "c1", name: "db-prod", adapterId: "mysql", type: "database", storageRole: null, lastStatus: "OFFLINE" }] as never);

        const hits = await searchRecords("prod", { ...NONE, connections: ["database"] }, HOME);

        expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { name: { contains: "prod" }, type: { in: ["database"] } } }));
        expect(hits).toEqual([{ kind: "connection", id: "c1", name: "db-prod", adapterId: "mysql", type: "database", storageRole: null, status: "OFFLINE" }]);
    });

    it("finds the databases in the lists read from the servers, regardless of case, and skips a list it cannot read", async () => {
        prismaMock.databaseListCache.findMany.mockResolvedValue([
            { adapterConfigId: "s1", databasesJson: JSON.stringify([{ name: "shop", sizeInBytes: 2048 }, { name: "Shop_archive" }, { name: "wiki" }]), adapterConfig: { name: "db-prod", adapterId: "mysql" } },
            { adapterConfigId: "s2", databasesJson: "not json", adapterConfig: { name: "broken", adapterId: "postgres" } },
        ] as never);

        const hits = await searchRecords("SHOP", { ...NONE, databases: true }, HOME);

        expect(hits).toEqual([
            { kind: "database", serverId: "s1", serverName: "db-prod", adapterId: "mysql", name: "shop", sizeInBytes: 2048 },
            { kind: "database", serverId: "s1", serverName: "db-prod", adapterId: "mysql", name: "Shop_archive", sizeInBytes: null },
        ]);
    });

    it("finds the latest runs of a job by its name", async () => {
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "r1", status: "Failed", startedAt: new Date("2026-09-30T02:00:00.000Z"), job: { name: "Nightly MySQL", source: { adapterId: "mysql" } } },
        ] as never);

        const hits = await searchRecords("nightly", { ...NONE, runs: true }, HOME);

        expect(hits).toEqual([{ kind: "run", id: "r1", name: "Nightly MySQL", status: "Failed", startedAt: "2026-09-30T02:00:00.000Z", adapterId: "mysql" }]);
    });

    it("finds people by name or email, groups with how many are in them and API keys with whether they work", async () => {
        prismaMock.user.findMany.mockResolvedValue([{ id: "u1", name: "Manu", email: "ops@example.com", memberships: [{ group: { name: "Admin" } }] }] as never);
        prismaMock.group.findMany.mockResolvedValue([{ id: "g1", name: "Operators", _count: { memberships: 3 } }] as never);
        prismaMock.apiKey.findMany.mockResolvedValue([
            { id: "k1", name: "CI ops", prefix: "dbackup_a3f2b1c8", enabled: true, expiresAt: new Date("2020-01-01"), user: { name: "Manu" } },
            { id: "k2", name: "Ops cron", prefix: "dbackup_b4c5d6e7", enabled: false, expiresAt: null, user: { name: "Manu" } },
        ] as never);

        const hits = await searchRecords("ops", { ...NONE, users: true, groups: true, apiKeys: true }, "tenant-a");

        // Accounts belong to no tenant, so the search names the people of this one itself.
        expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { AND: [{ memberships: { some: { tenantId: "tenant-a" } } }, { OR: [{ name: { contains: "ops" } }, { email: { contains: "ops" } }] }] },
        }));
        // A group belongs to its tenant, which opens it in All tenants, and who holds it is counted there.
        expect(prismaMock.group.findMany).toHaveBeenCalledWith(expect.objectContaining({
            select: { id: true, name: true, tenantId: true, _count: { select: { memberships: { where: { tenantId: "tenant-a" } } } } },
        }));
        expect(selected(prismaMock.apiKey.findMany)).not.toContain("hashedKey");
        expect(hits).toEqual([
            { kind: "user", id: "u1", name: "Manu", email: "ops@example.com", group: "Admin" },
            { kind: "group", id: "g1", name: "Operators", people: 3 },
            { kind: "apiKey", id: "k1", name: "CI ops", prefix: "dbackup_a3f2b1c8", owner: "Manu", enabled: true, expired: true },
            { kind: "apiKey", id: "k2", name: "Ops cron", prefix: "dbackup_b4c5d6e7", owner: "Manu", enabled: false, expired: false },
        ]);
    });

    it("finds in the home tenant the accounts of no tenant too, without a group", async () => {
        prismaMock.user.findMany.mockResolvedValue([{ id: "u2", name: "Sara Nguyen", email: "sara@example.com", memberships: [] }] as never);

        const hits = await searchRecords("sara", { ...NONE, users: true }, HOME);

        expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { AND: [{ OR: [{ memberships: { some: { tenantId: HOME } } }, { memberships: { none: {} } }] }, { OR: [{ name: { contains: "sara" } }, { email: { contains: "sara" } }] }] },
        }));
        expect(hits).toEqual([{ kind: "user", id: "u2", name: "Sara Nguyen", email: "sara@example.com", group: null }]);
    });

    it("finds the templates of every kind in the order of their names", async () => {
        prismaMock.retentionPolicy.findMany.mockResolvedValue([{ id: "t1", name: "Keep daily", description: "Seven days" }] as never);
        prismaMock.namingTemplate.findMany.mockResolvedValue([{ id: "t2", name: "Daily files", pattern: "{name}_yyyy-MM-dd" }] as never);
        prismaMock.schedulePreset.findMany.mockResolvedValue([{ id: "t3", name: "Daily at 2", schedule: "0 2 * * *" }] as never);

        const hits = await searchRecords("daily", { ...NONE, templates: true }, HOME);

        expect(hits).toEqual([
            { kind: "template", id: "t3", name: "Daily at 2", template: "schedules", detail: "0 2 * * *" },
            { kind: "template", id: "t2", name: "Daily files", template: "naming", detail: "{name}_yyyy-MM-dd" },
            { kind: "template", id: "t1", name: "Keep daily", template: "retention", detail: "Seven days" },
        ]);
    });

    it("finds the keys and saved logins of the Vault without reading what they hold", async () => {
        prismaMock.encryptionProfile.findMany.mockResolvedValue([{ id: "e1", name: "Prod key", _count: { jobs: 2 } }] as never);
        prismaMock.credentialProfile.findMany.mockResolvedValue([{ id: "c1", name: "Prod login", type: "SSH_KEY" }] as never);

        const hits = await searchRecords("prod", { ...NONE, keys: true, credentials: true }, HOME);

        expect(selected(prismaMock.encryptionProfile.findMany)).not.toContain("secretKey");
        expect(selected(prismaMock.credentialProfile.findMany)).not.toContain("data");
        expect(hits).toEqual([
            { kind: "key", id: "e1", name: "Prod key", jobs: 2 },
            { kind: "credential", id: "c1", name: "Prod login", type: "SSH_KEY" },
        ]);
    });

    it("searches no kind the viewer may not see", async () => {
        expect(await searchRecords("mysql", NONE, HOME)).toEqual([]);
        for (const model of [prismaMock.job, prismaMock.adapterConfig, prismaMock.databaseListCache, prismaMock.execution, prismaMock.user, prismaMock.group, prismaMock.apiKey, prismaMock.retentionPolicy, prismaMock.encryptionProfile, prismaMock.credentialProfile]) {
            expect(model.findMany).not.toHaveBeenCalled();
        }
    });
});

describe("the search of a platform admin in All tenants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const model of [prismaMock.job, prismaMock.adapterConfig, prismaMock.databaseListCache, prismaMock.execution, prismaMock.user, prismaMock.group, prismaMock.apiKey, prismaMock.retentionPolicy, prismaMock.namingTemplate, prismaMock.schedulePreset, prismaMock.notificationTemplate, prismaMock.excludePatternPreset, prismaMock.encryptionProfile, prismaMock.credentialProfile]) {
            model.findMany.mockResolvedValue([] as never);
        }
    });

    it("names the tenant of every record it finds, so a hit opens in its tenant", async () => {
        prismaMock.job.findMany.mockResolvedValue([{ id: "j1", name: "Nightly MySQL", tenantId: "acme", enabled: true, schedule: "0 2 * * *", schedulePreset: null, source: { adapterId: "mysql" } }] as never);
        prismaMock.execution.findFirst.mockResolvedValue(null);
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ id: "c1", name: "Nightly db", tenantId: "globex", adapterId: "mysql", type: "database", storageRole: null, lastStatus: "ONLINE", metadata: null }] as never);
        prismaMock.databaseListCache.findMany.mockResolvedValue([{ adapterConfigId: "c1", databasesJson: JSON.stringify([{ name: "nightly_orders" }]), adapterConfig: { name: "Nightly db", adapterId: "mysql", tenantId: "globex" } }] as never);
        prismaMock.encryptionProfile.findMany.mockResolvedValue([{ id: "e1", name: "Nightly key", tenantId: "acme", _count: { jobs: 1 } }] as never);

        const hits = await searchRecords("nightly", { ...NONE, jobs: true, backups: true, databases: true, connections: ["database"], keys: true }, null);

        expect(hits).toEqual([
            { kind: "job", id: "j1", name: "Nightly MySQL", enabled: true, schedule: "0 2 * * *", adapterId: "mysql", lastStatus: null, tenantId: "acme" },
            { kind: "backups", jobId: "j1", name: "Nightly MySQL", tenantId: "acme" },
            { kind: "connection", id: "c1", name: "Nightly db", adapterId: "mysql", type: "database", storageRole: null, status: "ONLINE", tenantId: "globex" },
            { kind: "database", serverId: "c1", serverName: "Nightly db", adapterId: "mysql", name: "nightly_orders", sizeInBytes: null, tenantId: "globex" },
            { kind: "key", id: "e1", name: "Nightly key", jobs: 1, tenantId: "acme" },
        ]);
    });

    it("finds every account of the instance with the tenants it works in, and counts each holder of a group once", async () => {
        prismaMock.user.findMany.mockResolvedValue([{ id: "u1", name: "Manu", email: "ops@example.com", _count: { memberships: 2 } }] as never);
        prismaMock.group.findMany.mockResolvedValue([{ id: "g1", name: "Operators", memberships: [{ userId: "u1" }, { userId: "u1" }, { userId: "u2" }] }] as never);

        const hits = await searchRecords("ops", { ...NONE, users: true, groups: true }, null);

        // No tenant narrows the accounts, All tenants shows each of them once.
        expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { OR: [{ name: { contains: "ops" } }, { email: { contains: "ops" } }] },
        }));
        expect(hits).toEqual([
            { kind: "user", id: "u1", name: "Manu", email: "ops@example.com", group: null, tenants: 2 },
            { kind: "group", id: "g1", name: "Operators", people: 2 },
        ]);
    });
});
