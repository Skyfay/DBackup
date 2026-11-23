/**
 * The accounts that run the platform, a platform admin or someone of a platform group, need no
 * group in a tenant to see something. The home tenant lists them among its people when they work
 * in no tenant, so its Users tab counts them as placed, never as someone without a group who sees
 * nothing, and Through the platform leaves them out, so they never show twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    user: { findMany: vi.fn() },
    apiKey: { findMany: vi.fn() },
    tenant: { count: vi.fn(), findUnique: vi.fn() },
    platformGroup: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

const { buildUsersModel, getUsersPageAttention } = await import("@/services/user/users-model");
const { platformPeopleOf } = await import("@/services/user/platform-people");
type Build = Parameters<typeof buildUsersModel>[0];

const NOW = Date.parse("2026-10-17T12:00:00Z");

function account(overrides: Partial<Build["users"][number]> & { id: string; name: string }): Build["users"][number] {
    return {
        email: `${overrides.id}@example.ch`,
        image: null,
        createdAt: new Date(NOW - 86_400_000),
        twoFactorEnabled: true,
        passkeyTwoFactor: false,
        platformRole: null,
        memberships: [],
        accounts: [{ providerId: "credential" }],
        sessions: [],
        _count: { apiKeys: 0, passkeys: 0 },
        ...overrides,
    };
}

/** The home tenant: Root runs it as platform admin, Nina through a platform group, Sara has nothing. */
const PEOPLE = [
    account({ id: "root", name: "Root", platformRole: "ADMIN" }),
    account({ id: "nina", name: "Nina", platformGroupId: "pg-support" }),
    account({ id: "lena", name: "Lena", memberships: [{ group: { id: "g-ops", name: "Operators" } }] }),
    account({ id: "sara", name: "Sara" }),
];

beforeEach(() => {
    vi.clearAllMocks();
    db.user.findMany.mockResolvedValue([]);
    db.apiKey.findMany.mockResolvedValue([]);
});

describe("the accounts of the platform on the Users tab of the home tenant", () => {
    it("counts them as placed, so only the account without anything sees nothing", () => {
        const model = buildUsersModel({ users: PEOPLE, groups: [], providers: [], logins: new Map(), viewerId: "root", viewerPlatformAdmin: true, now: NOW });

        expect(model.stats.inGroup).toBe(3);
        expect(model.stats.withoutGroup).toEqual(["Sara"]);
        const byId = new Map(model.users.map((row) => [row.id, row]));
        expect(byId.get("nina")?.withPlatformGroup).toBe(true);
        expect(byId.get("sara")).not.toHaveProperty("withPlatformGroup");
    });

    it("counts an account of a platform group in no tenant as placed in All tenants too", () => {
        const everyone = PEOPLE.map((person) => ({ ...person, memberships: person.memberships.map((membership) => ({ ...membership, tenantId: "acme" })) }));
        const model = buildUsersModel({ users: everyone, groups: [], providers: [], logins: new Map(), viewerId: "root", viewerPlatformAdmin: true, allTenants: true, now: NOW });

        expect(model.stats.withoutGroup).toEqual(["Sara"]);
    });

    it("marks the tab only for an account of no tenant that runs nothing of the platform", async () => {
        db.user.findMany.mockResolvedValue([{ name: "Sara" }]);

        const attention = await getUsersPageAttention("default", NOW);

        expect(db.user.findMany.mock.calls[0][0].where).toEqual({ memberships: { none: {} }, platformRole: null, platformGroupId: null });
        expect(attention.users).toEqual(expect.objectContaining({ tone: "warning" }));
    });

    it("leaves the people of the tenant out of Through the platform, the accounts of no tenant too in the home tenant", async () => {
        db.tenant.count.mockResolvedValue(3);
        db.tenant.findUnique.mockResolvedValue({ name: "Skyfay Hosting" });
        db.platformGroup.findMany.mockResolvedValue([]);

        await platformPeopleOf("default");

        const outside = { NOT: { OR: [{ memberships: { some: { tenantId: "default" } } }, { memberships: { none: {} } }] } };
        expect(db.user.findMany.mock.calls[0][0].where).toEqual({ platformRole: "ADMIN", ...outside });
        expect(db.platformGroup.findMany.mock.calls[0][0].select.members.where).toEqual(outside);

        await platformPeopleOf("acme");
        expect(db.user.findMany.mock.calls[1][0].where).toEqual({ platformRole: "ADMIN", NOT: { memberships: { some: { tenantId: "acme" } } } });
    });
});
