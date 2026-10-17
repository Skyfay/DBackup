/**
 * The servers of other tenants join the list of database connections only when the Connections page
 * asks for them. A picker, the job form and the Database Explorer ask for the plain list, which never
 * holds one and never loads them. The page also gets how many databases each own server held at its
 * last read, from the cached lists, without asking a server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));

const mocks = vi.hoisted(() => ({
    sharedRows: vi.fn(),
    overview: vi.fn(),
    provided: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/sharing/shared-server-rows", () => ({ sharedServerItems: mocks.sharedRows }));
vi.mock("@/services/adapters/connection-overview", () => ({ getConnectionOverview: mocks.overview }));
vi.mock("@/services/sharing/connection-options", () => ({ providedItems: mocks.provided }));
vi.mock("@/services/sharing/connection-shares", () => ({ connectionShareService: { summaries: vi.fn().mockResolvedValue(new Map()) } }));

const { listAdapters } = await import("@/services/adapters/adapter-list");
const { listedDatabasesOf } = await import("@/services/adapters/connection-databases");

const own = (id: string) => ({
    id, name: id, type: "database", adapterId: "postgres", config: JSON.stringify({ host: "erp.acme.local", port: 5432 }),
    metadata: null, createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"), primaryCredentialId: null, sshCredentialId: null,
    defaultRetentionPolicyId: null, lastHealthCheck: new Date("2026-10-17"), lastStatus: "ONLINE", lastError: null, consecutiveFailures: 0,
    storageRole: "DESTINATION", tenantId: "acme",
});

const SHARED_ROW = { id: "shared:srv-mysql", name: "Shared MySQL 8.0", type: "database", adapterId: "mysql", config: "{}", sharedServer: { backups: 31 } };

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.adapterConfig.findMany.mockResolvedValue([own("own-pg")] as never);
    prismaMock.databaseListCache.findMany.mockResolvedValue([{ adapterConfigId: "own-pg", databasesJson: JSON.stringify([{ name: "acme_erp" }]) }] as never);
    mocks.sharedRows.mockResolvedValue([SHARED_ROW]);
    mocks.overview.mockResolvedValue(new Map([["own-pg", { usedBy: { jobs: 1, templates: 0 } }]]));
    mocks.provided.mockResolvedValue([]);
});

describe("the list of database connections", () => {
    it("holds the provided servers after the own ones when the Connections page asks for them", async () => {
        const items = await listAdapters("database", { overview: true, sharedServers: { tenantId: "acme", backups: true } });

        expect(items.map((item) => item.id)).toEqual(["own-pg", "shared:srv-mysql"]);
        expect(mocks.sharedRows).toHaveBeenCalledWith("acme", { backups: true });
        // A provided server has no overview of its own, and the overview never looks for it.
        expect(items[1].overview).toBeNull();
        expect(mocks.overview).toHaveBeenCalledWith(["own-pg"]);
    });

    it("passes on whether the viewer may see the backups themselves", async () => {
        await listAdapters("database", { sharedServers: { tenantId: "acme", backups: false } });
        expect(mocks.sharedRows).toHaveBeenCalledWith("acme", { backups: false });
    });

    it("never holds a provided server without the flag, and never loads them", async () => {
        const plain = await listAdapters("database");
        const withOverview = await listAdapters("database", { overview: true });

        expect(plain.map((item) => item.id)).toEqual(["own-pg"]);
        expect(withOverview.map((item) => item.id)).toEqual(["own-pg"]);
        expect(mocks.sharedRows).not.toHaveBeenCalled();
    });

    it("never adds provided servers to destinations or channels, whatever the flag", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);
        await listAdapters("storage", { sharedServers: { tenantId: "acme", backups: true } });
        await listAdapters("notification", { sharedServers: { tenantId: "acme", backups: true } });

        expect(mocks.sharedRows).not.toHaveBeenCalled();
    });

    it("tells how many databases an own server held at its last read, only to the tables", async () => {
        const [table] = await listAdapters("database", { overview: true });
        expect(table.listedDatabases).toEqual({ count: 1, names: ["acme_erp"] });

        const [picker] = await listAdapters("database");
        expect(picker.listedDatabases).toBeUndefined();
    });
});

describe("the databases an own server held at its last read", () => {
    it("are counted with the first names by the alphabet, from servers that were read", async () => {
        prismaMock.databaseListCache.findMany.mockResolvedValue([
            { adapterConfigId: "big", databasesJson: JSON.stringify(["shop", "crm", "blog", "wiki"].map((name) => ({ name, sizeInBytes: 10 }))) },
            { adapterConfigId: "broken", databasesJson: "not json" },
        ] as never);
        const listed = await listedDatabasesOf(["big", "broken", "unread"]);

        expect(listed.get("big")).toEqual({ count: 4, names: ["blog", "crm", "shop"] });
        expect(listed.has("broken")).toBe(false);
        expect(listed.has("unread")).toBe(false);
        expect(prismaMock.databaseListCache.findMany.mock.calls[0][0]?.where).toEqual({ adapterConfigId: { in: ["big", "broken", "unread"] }, readAt: { not: null } });
    });

    it("ask nothing for no connection", async () => {
        expect((await listedDatabasesOf([])).size).toBe(0);
        expect(prismaMock.databaseListCache.findMany).not.toHaveBeenCalled();
    });
});
