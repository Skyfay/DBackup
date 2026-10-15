import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { explicitScope } from "@/lib/tenant/context";

vi.mock("@/services/auth/password-policy-service", () => ({ getPasswordPolicy: vi.fn(async () => ({ minLength: 12 })) }));

const { buildUsersModel } = await import("@/services/user/users-model");
const { getAllUsersModel } = await import("@/services/user/users-all-model");
const { getPlatformGroupsModel } = await import("@/services/user/groups-model");
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

    it("counts an account of no tenant as the one who sees nothing, never one with a group somewhere", () => {
        const model = buildAll([
            account({ id: "carla", name: "Carla", memberships: [{ tenantId: "tenant-a", group: OPERATORS }] }),
            account({ id: "sara", name: "Sara Nguyen" }),
            account({ id: "root", name: "Root", platformRole: "ADMIN" }),
        ]);

        expect(model.users.find((row) => row.id === "sara")?.tenants).toEqual([]);
        expect(model.stats.users).toBe(3);
        expect(model.stats.inGroup).toBe(1);
        expect(model.stats.withoutGroup).toEqual(["Root", "Sara Nguyen"]);
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
