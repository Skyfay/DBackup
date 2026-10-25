import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { explicitScope } from "@/lib/tenant/context";

vi.mock("@/services/auth/password-policy-service", () => ({ getPasswordPolicy: vi.fn(async () => ({ minLength: 12 })) }));

const { buildUsersModel } = await import("@/services/user/users-model");
const { getAllUsersModel } = await import("@/services/user/users-all-model");
const { getPlatformGroupsModel, platformTenantNames } = await import("@/services/user/groups-model");
type Build = Parameters<typeof buildUsersModel>[0];

const NOW = Date.parse("2026-10-15T12:00:00Z");
const at = (iso: string) => new Date(iso);
const OPERATORS = { id: "g-ops", name: "Operators" };
const VIEWERS = { id: "g-view", name: "Viewers" };

function account(overrides: Partial<Build["users"][number]> & { id: string; name: string }): Build["users"][number] {
    return {
        email: `${overrides.id}@example.ch`,
        image: null,
        createdAt: at("2026-06-01T09:00:00Z"),
        twoFactorEnabled: false,
        passkeyTwoFactor: false,
        platformRole: null,
        memberships: [],
        accounts: [{ providerId: "credential" }],
        sessions: [],
        _count: { apiKeys: 0, passkeys: 0 },
        ...overrides,
    };
}

function buildAll(users: Build["users"]) {
    return buildUsersModel({
        users,
        groups: [{ id: "g-ops", name: "Operators", permissions: JSON.stringify(["jobs:read"]), fullAccess: false, _count: { memberships: 3 } }],
        providers: [],
        logins: new Map(),
        viewerId: "root",
        viewerPlatformAdmin: true,
        allTenants: true,
        now: NOW,
    });
}

describe("every account of the instance in All tenants", () => {
    it("names each tenant of an account with its group there, instead of a group of its own", () => {
        const model = buildAll([
            account({ id: "tech", name: "Tom Tech", memberships: [{ tenantId: "default", group: OPERATORS }, { tenantId: "tenant-a", group: VIEWERS }] }),
            account({ id: "carla", name: "Carla", memberships: [{ tenantId: "tenant-a", group: OPERATORS }] }),
        ]);
        const byId = new Map(model.users.map((row) => [row.id, row]));

        expect(model.allTenants).toBe(true);
        expect(byId.get("tech")?.group).toBeNull();
        expect(byId.get("tech")?.tenants).toEqual([
            { tenantId: "default", group: OPERATORS },
            { tenantId: "tenant-a", group: VIEWERS },
        ]);
        expect(byId.get("carla")?.tenants).toEqual([{ tenantId: "tenant-a", group: OPERATORS }]);
    });

    it("marks an account of several tenants as shared, which only a platform admin changes", () => {
        const model = buildAll([
            account({ id: "tech", name: "Tom Tech", memberships: [{ tenantId: "default", group: OPERATORS }, { tenantId: "tenant-a", group: VIEWERS }] }),
            account({ id: "carla", name: "Carla", memberships: [{ tenantId: "tenant-a", group: OPERATORS }] }),
        ]);
        const byId = new Map(model.users.map((row) => [row.id, row]));

        expect(byId.get("tech")?.elsewhere).toBe(true);
        expect(byId.get("carla")?.elsewhere).toBe(false);
    });

    it("counts an account of no tenant as the one who sees nothing, never one with a group somewhere or a platform admin", () => {
        const model = buildAll([
            account({ id: "carla", name: "Carla", memberships: [{ tenantId: "tenant-a", group: OPERATORS }] }),
            account({ id: "sara", name: "Sara Nguyen" }),
            account({ id: "root", name: "Root", platformRole: "ADMIN" }),
        ]);

        expect(model.users.find((row) => row.id === "sara")?.tenants).toEqual([]);
        expect(model.stats.users).toBe(3);
        expect(model.stats.inGroup).toBe(2);
        expect(model.stats.withoutGroup).toEqual(["Sara Nguyen"]);
    });

    it("leaves the rows of a tenant as they were, without tenants", () => {
        const model = buildUsersModel({
            users: [account({ id: "carla", name: "Carla", memberships: [{ group: OPERATORS }] })],
            groups: [],
            providers: [],
            logins: new Map(),
            viewerId: "root",
            viewerPlatformAdmin: true,
            now: NOW,
        });

        expect(model.allTenants).toBe(false);
        expect(model.users[0].group).toEqual(OPERATORS);
        expect(model.users[0]).not.toHaveProperty("tenants");
    });
});

describe("loading every account and every group for the Platform", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.ssoProvider.findMany.mockResolvedValue([] as never);
        prismaMock.auditLog.findMany.mockResolvedValue([] as never);
    });

    it("reads every account with all its memberships and the keys of every tenant", async () => {
        prismaMock.user.findMany.mockResolvedValue([
            account({ id: "tech", name: "Tom Tech", memberships: [{ tenantId: "tenant-a", group: OPERATORS }], _count: { apiKeys: 2, passkeys: 0 } }),
        ] as never);
        prismaMock.group.findMany.mockResolvedValue([] as never);

        const model = await getAllUsersModel("root");

        const query = prismaMock.user.findMany.mock.calls[0][0] as { where?: unknown; select: { memberships: unknown; _count: unknown } };
        // No filter: the accounts of no tenant show too.
        expect(query.where).toBeUndefined();
        expect(query.select.memberships).toEqual(expect.objectContaining({ select: { tenantId: true, group: { select: { id: true, name: true } } } }));
        expect(query.select._count).toEqual({ select: { apiKeys: true, passkeys: true } });
        expect(model).toEqual(expect.objectContaining({ allTenants: true, homeTenant: false, viewerPlatformAdmin: true, passwordPolicy: { minLength: 12 } }));
        expect(model.users[0]).toEqual(expect.objectContaining({ id: "tech", apiKeys: 2, tenants: [{ tenantId: "tenant-a", group: OPERATORS }] }));
    });

    it("reads every tenant even when the platform admin opens it from inside a customer tenant, with each group in its tenant", async () => {
        let scope: unknown = null;
        prismaMock.user.findMany.mockResolvedValue([] as never);
        prismaMock.group.findMany.mockImplementation((async () => {
            scope = explicitScope();
            return [
                { id: "g-home", name: "Admin", permissions: "[]", fullAccess: true, tenantId: "default", _count: { memberships: 1 } },
                { id: "g-acme", name: "Admin", permissions: "[]", fullAccess: true, tenantId: "tenant-a", _count: { memberships: 2 } },
            ];
        }) as never);

        const model = await getAllUsersModel("root");

        expect(scope).toEqual({ kind: "system" });
        expect(model.groups.map((group) => [group.id, group.tenantId])).toEqual(expect.arrayContaining([["g-acme", "tenant-a"], ["g-home", "default"]]));
    });

    it("lists the groups of every tenant with their tenant and members, read in every tenant and with nobody to move", async () => {
        let scope: unknown = null;
        prismaMock.tenantGroupTemplate.findMany.mockResolvedValue([] as never);
        prismaMock.group.findMany.mockImplementation((async () => {
            scope = explicitScope();
            return [
                {
                    id: "g-ops",
                    name: "Operators",
                    permissions: JSON.stringify(["jobs:read"]),
                    fullAccess: false,
                    createdAt: at("2026-03-01T09:00:00Z"),
                    tenantId: "tenant-a",
                    memberships: [
                        { user: { id: "tech", name: "Tom Tech", email: "tom@example.ch", image: null } },
                        { user: { id: "carla", name: "Carla", email: "carla@example.ch", image: null } },
                    ],
                },
                { id: "g-empty", name: "Empty", permissions: "[]", fullAccess: false, createdAt: at("2026-03-01T09:00:00Z"), tenantId: "default", memberships: [] },
            ];
        }) as never);

        const model = await getPlatformGroupsModel("tech");
        const ops = model.groups.find((group) => group.id === "g-ops");

        expect(scope).toEqual({ kind: "system" });
        expect(model.allTenants).toBe(true);
        expect(ops?.tenantId).toBe("tenant-a");
        expect(ops?.members).toEqual([
            { id: "carla", name: "Carla", email: "carla@example.ch", image: null, isYou: false },
            { id: "tech", name: "Tom Tech", email: "tom@example.ch", image: null, isYou: true },
        ]);
        expect(model.stats.empty).toEqual(["Empty"]);
        // People move between the groups of a tenant inside that tenant.
        expect(model.people).toBeNull();
    });
});

describe("the accounts a platform group of some tenants sees on the Platform", () => {
    /** Nina's platform group sees and manages the accounts of tenant A, where it reads the jobs. She is also the admin of tenant C. */
    const NINA = {
        memberships: [{ tenantId: "tenant-c", group: { permissions: JSON.stringify(["users:read", "users:write", "jobs:read"]), fullAccess: false } }],
        platformGroup: { platformPermissions: JSON.stringify(["platform-accounts:read", "platform-accounts:write"]), tenantPermissions: JSON.stringify(["jobs:read"]), allTenants: false, tenants: [{ tenantId: "tenant-a" }] },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.ssoProvider.findMany.mockResolvedValue([] as never);
        prismaMock.auditLog.findMany.mockResolvedValue([] as never);
        prismaMock.user.findUnique.mockResolvedValue(NINA as never);
        prismaMock.group.findMany.mockResolvedValue([
            { id: "g-a", name: "Operators", permissions: JSON.stringify(["jobs:read"]), fullAccess: false, tenantId: "tenant-a", _count: { memberships: 2 } },
            { id: "g-c", name: "Viewers", permissions: JSON.stringify(["jobs:read"]), fullAccess: false, tenantId: "tenant-c", _count: { memberships: 1 } },
        ] as never);
        // What the database answers for the filter of the query: the people of tenant A and her own account.
        prismaMock.user.findMany.mockResolvedValue([
            account({ id: "tech", name: "Tom Tech", memberships: [{ tenantId: "default", group: OPERATORS }, { tenantId: "tenant-a", group: VIEWERS }] }),
            account({ id: "carla", name: "Carla", memberships: [{ tenantId: "tenant-a", group: OPERATORS }] }),
        ] as never);
    });

    it("lists the people of the tenants it reaches and the own account, never an account of no tenant or of other tenants alone", async () => {
        await getAllUsersModel("nina", false);

        const query = prismaMock.user.findMany.mock.calls[0][0] as { where?: unknown; select: { _count: unknown } };
        expect(query.where).toEqual({ OR: [{ id: "nina" }, { memberships: { some: { tenantId: { in: ["tenant-a"] } } } }] });
        // The keys of the tenants it reaches alone.
        expect(query.select._count).toEqual({ select: { apiKeys: { where: { tenantId: { in: ["tenant-a"] } } }, passkeys: true } });
        // The groups of the tenants it reaches and of the tenant whose users she manages.
        expect(prismaMock.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: { in: ["tenant-a", "tenant-c"] } } }));
    });

    it("names only the tenants it reaches of an account, and marks one that works beyond them as not changed by it", async () => {
        const model = await getAllUsersModel("nina", false);
        const byId = new Map(model.users.map((row) => [row.id, row]));

        expect(byId.get("tech")?.tenants).toEqual([{ tenantId: "tenant-a", group: VIEWERS }]);
        expect(byId.get("tech")).toEqual(expect.objectContaining({ beyondReach: true, elsewhere: true }));
        expect(byId.get("carla")?.tenants).toEqual([{ tenantId: "tenant-a", group: OPERATORS }]);
        expect(byId.get("carla")).not.toHaveProperty("beyondReach");
    });

    it("offers New user the tenants it reaches and the one whose users she manages", async () => {
        const model = await getAllUsersModel("nina", false);

        expect(model.newUserTenants).toEqual(["tenant-a", "tenant-c"]);
        expect(model.newUserGroups).toEqual(["g-a", "g-c"]);
        expect(model.managedTenants).toEqual(["tenant-a"]);
    });

    it("leaves a group out of New user that may do more than she may in its tenant", async () => {
        prismaMock.user.findUnique.mockResolvedValue({ ...NINA, platformGroup: { ...NINA.platformGroup, tenantPermissions: "[]" } } as never);

        expect((await getAllUsersModel("nina", false)).newUserGroups).toEqual(["g-c"]);
    });

    it("reads every account for a platform group of all tenants, as for a platform admin", async () => {
        prismaMock.user.findUnique.mockResolvedValue({ ...NINA, platformGroup: { ...NINA.platformGroup, allTenants: true, tenants: [] } } as never);

        const model = await getAllUsersModel("nina", false);

        const query = prismaMock.user.findMany.mock.calls[0][0] as { where?: unknown };
        expect(query.where).toBeUndefined();
        expect(prismaMock.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
        expect(model.users.find((row) => row.id === "tech")?.tenants).toHaveLength(2);
        expect(model.users.some((row) => row.beyondReach)).toBe(false);
        expect(model.newUserTenants).toBeNull();
    });

    it("lists the groups of the tenants it reaches alone on the Groups tab", async () => {
        prismaMock.tenantGroupTemplate.findMany.mockResolvedValue([] as never);
        prismaMock.group.findMany.mockResolvedValue([] as never);

        await getPlatformGroupsModel("nina", ["tenant-a"]);
        expect(prismaMock.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: { in: ["tenant-a"] } } }));

        await getPlatformGroupsModel("root");
        expect(prismaMock.group.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: undefined }));
    });

    it("hands the page the names of the tenants it reaches alone", async () => {
        prismaMock.tenant.findMany.mockResolvedValue([{ id: "tenant-a", name: "Acme" }] as never);

        expect(await platformTenantNames(["tenant-a"])).toEqual([{ id: "tenant-a", name: "Acme" }]);
        expect(prismaMock.tenant.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: { in: ["tenant-a"] } } }));

        await platformTenantNames("all");
        expect(prismaMock.tenant.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: undefined }));

        prismaMock.tenant.findMany.mockClear();
        expect(await platformTenantNames([])).toEqual([]);
        expect(prismaMock.tenant.findMany).not.toHaveBeenCalled();
    });

    it("names only the tenants it reaches of a group for tenants, never another by its id", async () => {
        prismaMock.group.findMany.mockResolvedValue([] as never);
        prismaMock.tenantGroupTemplate.findMany.mockResolvedValue([{
            id: "tpl-client", name: "Client", permissions: "[]", allTenants: false, createdAt: at("2026-03-01T09:00:00Z"), updatedAt: at("2026-03-01T09:00:00Z"),
            tenants: [{ tenantId: "tenant-a" }, { tenantId: "tenant-b" }],
            groups: [{ id: "g-a", tenantId: "tenant-a", memberships: [] }, { id: "g-b", tenantId: "tenant-b", memberships: [] }],
        }] as never);

        const reached = await getPlatformGroupsModel("nina", ["tenant-a"]);
        expect(reached.templates?.[0]).toEqual(expect.objectContaining({ tenantIds: ["tenant-a"], groups: [expect.objectContaining({ tenantId: "tenant-a" })] }));

        const all = await getPlatformGroupsModel("root");
        expect(all.templates?.[0].tenantIds).toEqual(["tenant-a", "tenant-b"]);
    });
});
