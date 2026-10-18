/**
 * The routes that manage the tenants, their members, their invitations and what a tenant shares,
 * for the automation of an MSP. A key carries a right of the platform only when it was made in the
 * home tenant and its owner holds it, reaches what its owner reaches, and a key of a customer acts
 * in its own tenant only. The rules come from the same services as Platform > Tenants.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ALL_TENANTS_PERMISSIONS, capToOwner, EVERY_PERMISSION, ownerPermissionsIn, PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const P = PERMISSIONS;

const mocks = vi.hoisted(() => ({
    ctx: null as unknown,
    reach: new Map<string, "all" | string[]>(),
    people: new Map<string, string[]>(),
    tenants: { list: vi.fn(), find: vi.fn(), create: vi.fn(), rename: vi.fn(), setSharing: vi.fn(), delete: vi.fn() },
    summaries: vi.fn(),
    contents: vi.fn(),
    setAllowances: vi.fn(),
    setNetwork: vi.fn(),
    onDemand: { set: vi.fn() },
    memberships: { members: vi.fn(), accounts: vi.fn(), isPlatformAdmin: vi.fn(), roleOf: vi.fn(), setRole: vi.fn(), isPersonOf: vi.fn() },
    groups: { find: vi.fn() },
    users: { permissionsIn: vi.fn() },
    usersModel: vi.fn(),
    invitations: { create: vi.fn(), list: vi.fn(), revoke: vi.fn() },
    shares: { view: vi.fn(), losing: vi.fn(), save: vi.fn() },
    assignments: { forSource: vi.fn(), addRule: vi.fn(), removeRule: vi.fn() },
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: async () => ({ name: "Nina" }) } } }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
// The real checks of `access-control.ts`, on the context of the request.
vi.mock("@/lib/auth/access-control", async () => {
    const { PermissionError } = await import("@/lib/logging/errors");
    const ALL_TENANTS_REFUSAL = "All tenants only reads. Open the tenant of the record to change it.";
    type Ctx = { isPlatformAdmin: boolean; allTenants: boolean; permissions: string[]; tenantId: string | null };
    const has = (ctx: Ctx, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission);
    return {
        ALL_TENANTS_REFUSAL,
        getAuthContext: async () => mocks.ctx,
        hasPermissionWithContext: has,
        checkPermissionWithContext: (ctx: Ctx, permission: string) => {
            if (!has(ctx, permission)) throw new PermissionError(permission, ctx.allTenants && !ALL_TENANTS_PERMISSIONS.includes(permission) ? { message: ALL_TENANTS_REFUSAL } : undefined);
        },
        checkAnyPermissionWithContext: (ctx: Ctx, permissions: string[]) => {
            if (!permissions.some((permission) => has(ctx, permission))) throw new PermissionError(permissions.join(" or "));
        },
        tenantOf: (ctx: Ctx & { allTenants: boolean }) => {
            if (!ctx.tenantId) throw new PermissionError("a tenant", { message: ctx.allTenants ? ALL_TENANTS_REFUSAL : "You work in no tenant yet." });
            return ctx.tenantId;
        },
    };
});
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: mocks.tenants }));
vi.mock("@/services/tenant/tenant-summaries", () => ({ tenantSummaries: mocks.summaries }));
vi.mock("@/services/tenant/tenant-contents", () => ({
    tenantContents: mocks.contents,
    isEmptyTenant: (contents: Record<string, number>) => Object.values(contents).every((count) => count === 0),
}));
vi.mock("@/services/tenant/tenant-allowances", () => ({ setAllowances: mocks.setAllowances, assertMayAddKind: vi.fn() }));
vi.mock("@/services/tenant/tenant-network", () => ({ setNetwork: mocks.setNetwork }));
vi.mock("@/services/tenant/tenant-on-demand", () => ({ tenantOnDemandService: mocks.onDemand }));
vi.mock("@/services/tenant/membership-service", () => ({ membershipService: mocks.memberships }));
vi.mock("@/services/user/group-service", () => ({ groupService: mocks.groups }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.users }));
vi.mock("@/services/user/users-model", () => ({ getUsersModel: mocks.usersModel }));
// Nina's platform group reaches Acme, a platform admin and Sam's group of all tenants every tenant.
vi.mock("@/services/user/platform-group-service", () => ({
    platformGroupService: {
        reachOf: async (userId: string) => mocks.reach.get(userId) ?? [],
        reaches: async (userId: string, tenantId: string) => {
            const reach = mocks.reach.get(userId) ?? [];
            return reach === "all" || reach.includes(tenantId);
        },
        reachesAll: async (userId: string) => mocks.reach.get(userId) === "all",
        peopleReached: async (userId: string) => mocks.people.get(userId) ?? [],
    },
}));
vi.mock("@/services/tenant/invitation-service", () => ({ INVITATION_MAX_DAYS: 30, invitationService: mocks.invitations }));
vi.mock("@/services/sharing/connection-shares", async () => {
    const { ValidationError } = await import("@/lib/logging/errors");
    class ShareChangeError extends ValidationError {
        constructor(message: string, readonly change: unknown) {
            super(message);
        }
    }
    return { connectionShareService: mocks.shares, ShareChangeError };
});
vi.mock("@/services/tenant/database-assignments", () => ({ databaseAssignmentService: mocks.assignments }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));

const tenantsRoute = await import("@/app/api/tenants/route");
const tenantRoute = await import("@/app/api/tenants/[id]/route");
const membersRoute = await import("@/app/api/tenants/[id]/members/route");
const memberRoute = await import("@/app/api/tenants/[id]/members/[userId]/route");
const invitationsRoute = await import("@/app/api/tenants/[id]/invitations/route");
const invitationRoute = await import("@/app/api/tenants/[id]/invitations/[invitationId]/route");
const shareRoute = await import("@/app/api/adapters/[id]/share/route");
const rulesRoute = await import("@/app/api/adapters/[id]/database-assignments/rules/route");
const ruleRoute = await import("@/app/api/adapters/[id]/database-assignments/rules/[ruleId]/route");

// ── The callers ──────────────────────────────────────────────────────────────

type Owner = Parameters<typeof ownerPermissionsIn>[0];

const group = (permissions: string[], tenants: string[] | "all") => ({
    platformPermissions: JSON.stringify(permissions),
    tenantPermissions: JSON.stringify([P.USERS.READ, P.USERS.WRITE]),
    allTenants: tenants === "all",
    tenants: tenants === "all" ? [] : tenants.map((tenantId) => ({ tenantId })),
});

/** Nina of the MSP, whose platform group manages the tenants it reaches, Acme only. */
const NINA: Owner = { platformRole: null, memberships: [], platformGroup: group([P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE, P.PLATFORM.SHARING_READ, P.PLATFORM.SHARING_WRITE], ["acme"]) };
/** The platform admin. */
const ROOT: Owner = { platformRole: PLATFORM_ADMIN_ROLE, memberships: [] };
/** Tom, the admin of Acme, a customer. */
const TOM: Owner = { platformRole: null, memberships: [{ tenantId: "acme", group: { permissions: "[]", fullAccess: true } }] };

const TENANT_RIGHTS = [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE];

/** A key as `apiKeyService.validate` hands it on: what it stores, capped to what its owner may in its tenant now. */
function keyOf(userId: string, owner: Owner, tenantId: string, stored: string[], shares = false) {
    return {
        userId,
        permissions: capToOwner(stored, ownerPermissionsIn(owner, tenantId, shares)),
        isPlatformAdmin: false,
        authMethod: "apikey" as const,
        apiKeyId: `key-${userId}`,
        tenantId,
        allTenants: false,
    };
}

const ninaKey = () => keyOf("nina", NINA, HOME_TENANT_ID, TENANT_RIGHTS, true);
/** Nina's key of the home tenant, which shares with customers, that also shares. */
const ninaSharingKey = () => keyOf("nina", NINA, HOME_TENANT_ID, [...TENANT_RIGHTS, P.PLATFORM.SHARING_READ, P.PLATFORM.SHARING_WRITE], true);
const rootKey = () => keyOf("root", ROOT, HOME_TENANT_ID, TENANT_RIGHTS, true);
const tomKey = (stored: string[]) => keyOf("tom", TOM, "acme", stored);
const rootSession = (tenantId: string | null = HOME_TENANT_ID) => ({
    userId: "root",
    permissions: tenantId ? [...EVERY_PERMISSION] : [...ALL_TENANTS_PERMISSIONS],
    isPlatformAdmin: true,
    authMethod: "session" as const,
    tenantId,
    allTenants: tenantId === null,
});

// ── Requests ─────────────────────────────────────────────────────────────────

const request = (method: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const params = <T extends Record<string, string>>(values: T) => ({ params: Promise.resolve(values) });
const json = async (response: Response) => ({ status: response.status, body: await response.json() });

const ROW = (id: string, name: string) => ({ id, name, isHome: id === HOME_TENANT_ID, sharesWithCustomers: id === HOME_TENANT_ID, members: 1, connections: 0, jobs: 0 });
const OPERATORS = { id: "g-ops", name: "Operators", permissions: JSON.stringify([P.USERS.READ]), fullAccess: false };
const ADMINS = { id: "g-admin", name: "Admin", permissions: "[]", fullAccess: true };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.reach = new Map<string, "all" | string[]>([["nina", ["acme"]], ["root", "all"]]);
    mocks.people = new Map([["nina", ["tom", "carla"]]]);
    mocks.tenants.list.mockResolvedValue([ROW(HOME_TENANT_ID, "Default"), ROW("acme", "Acme"), ROW("globex", "Globex")]);
    mocks.tenants.find.mockImplementation(async (id: string) => (["default", "acme", "globex"].includes(id) ? { id, name: id === "acme" ? "Acme" : id } : null));
    mocks.tenants.create.mockResolvedValue({ id: "t-new", name: "Initech" });
    mocks.tenants.rename.mockResolvedValue({ name: "Acme AG", renamedFrom: "Acme" });
    mocks.tenants.setSharing.mockResolvedValue({ name: "Acme", changed: true });
    mocks.tenants.delete.mockResolvedValue({ name: "Acme", connections: 2, jobs: 1, runs: 4, keys: 1, withdrawn: [] });
    mocks.summaries.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, jobs: 0, databases: 3, health: null })));
    mocks.contents.mockResolvedValue({ connections: 2, jobs: 1, members: 1, keys: 1, apiKeys: 0, deleted: 0 });
    mocks.setAllowances.mockResolvedValue({ name: "Acme", before: { databases: true, directorySources: true, destinations: true, channels: true, apiKeys: true }, after: { databases: false, directorySources: true, destinations: true, channels: true, apiKeys: true } });
    mocks.setNetwork.mockResolvedValue({ name: "Acme", before: { blocks: true, allowed: [] }, after: { blocks: true, allowed: ["10.10.0.0/16"] } });
    mocks.onDemand.set.mockResolvedValue({ name: "Acme", before: null, after: 3 });
    mocks.memberships.members.mockResolvedValue([{ id: "tom", name: "Tom", email: "tom@acme.example", image: null, group: { id: "g-admin", name: "Admin" }, platformAdmin: false }]);
    mocks.memberships.accounts.mockResolvedValue([
        { id: "tom", name: "Tom", email: "tom@acme.example", platformAdmin: false },
        { id: "carla", name: "Carla", email: "carla@example.ch", platformAdmin: false },
        { id: "gina", name: "Gina", email: "gina@globex.example", platformAdmin: false },
        { id: "root", name: "Root", email: "root@example.ch", platformAdmin: true },
    ]);
    mocks.memberships.isPlatformAdmin.mockImplementation(async (id: string) => id === "root");
    mocks.memberships.roleOf.mockResolvedValue(null);
    mocks.memberships.setRole.mockResolvedValue(undefined);
    mocks.memberships.isPersonOf.mockImplementation(async (userId: string, tenantId: string) => tenantId === "acme" && ["tom", "carla"].includes(userId));
    mocks.groups.find.mockImplementation(async (id: string) => ({ "g-ops": OPERATORS, "g-admin": ADMINS })[id] ?? null);
    // What Nina's platform group lets her do in Acme, the tenant rights it gives there.
    mocks.users.permissionsIn.mockImplementation(async (userId: string) => (userId === "root" ? [...EVERY_PERMISSION] : [P.USERS.READ, P.USERS.WRITE]));
    mocks.usersModel.mockResolvedValue({ groups: [{ id: "g-ops", name: "Operators", permissions: [P.USERS.READ], superAdmin: false }, { id: "g-admin", name: "Admin", permissions: [], superAdmin: true }] });
    mocks.invitations.create.mockResolvedValue({ id: "inv-1", token: "t".repeat(43), expiresAt: "2026-10-25T00:00:00.000Z" });
    mocks.invitations.list.mockResolvedValue([{ id: "inv-1", note: "New hire", createdByName: "Tom", createdAt: "2026-10-18T00:00:00.000Z", expiresAt: "2026-10-25T00:00:00.000Z", group: { id: "g-ops", name: "Operators" } }]);
    mocks.invitations.revoke.mockResolvedValue({ groupName: "Operators", note: "New hire" });
});

// ── The rights of a key ──────────────────────────────────────────────────────

describe("the rights of the platform an API key carries", () => {
    it("keeps the tenants for a key of the home tenant whose owner manages them", () => {
        expect(ninaKey().permissions).toEqual(expect.arrayContaining(TENANT_RIGHTS));
        expect(rootKey().permissions).toEqual(expect.arrayContaining(TENANT_RIGHTS));
    });

    it("drops them from a key of a customer, whatever it stores", () => {
        const key = tomKey([P.USERS.READ, ...TENANT_RIGHTS, P.PLATFORM.ACCOUNTS_WRITE]);
        expect(key.permissions).toEqual([P.USERS.READ]);
    });

    it("drops them from a key whose owner lost them", () => {
        const lost = keyOf("nina", { ...NINA, platformGroup: group([P.PLATFORM.SHARING_READ], ["acme"]) }, HOME_TENANT_ID, TENANT_RIGHTS, true);
        expect(lost.permissions).toEqual([]);
    });
});

// ── /api/tenants ─────────────────────────────────────────────────────────────

describe("the tenants through the API", () => {
    it("answers 401 without a session or a key", async () => {
        mocks.ctx = null;
        expect((await tenantsRoute.GET()).status).toBe(401);
        expect((await tenantsRoute.POST(request("POST", "/api/tenants", { name: "Initech" }))).status).toBe(401);
    });

    it("lists the tenants the platform group of the owner reaches, with the numbers of Platform > Tenants", async () => {
        mocks.ctx = ninaKey();
        const { status, body } = await json(await tenantsRoute.GET());

        expect(status).toBe(200);
        expect(body.data).toEqual([expect.objectContaining({ id: "acme", name: "Acme", databases: 3, health: null })]);
        expect(mocks.summaries).toHaveBeenCalledWith(["acme"]);
    });

    it("lists every tenant for the key of a platform admin and for All tenants", async () => {
        mocks.ctx = rootKey();
        expect((await json(await tenantsRoute.GET())).body.data).toHaveLength(3);
        mocks.ctx = rootSession(null);
        expect((await json(await tenantsRoute.GET())).body.data).toHaveLength(3);
    });

    it("refuses a key of a customer and a key whose owner lost the right, before it reads anything", async () => {
        mocks.ctx = tomKey([P.USERS.READ, ...TENANT_RIGHTS]);
        expect((await tenantsRoute.GET()).status).toBe(403);
        mocks.ctx = keyOf("nina", { ...NINA, platformGroup: null }, HOME_TENANT_ID, TENANT_RIGHTS, true);
        expect((await tenantsRoute.GET()).status).toBe(403);
        expect(mocks.tenants.list).not.toHaveBeenCalled();
    });

    it("creates a tenant for the key of a platform admin, into the log of the home tenant with the key", async () => {
        mocks.ctx = rootKey();
        const { status, body } = await json(await tenantsRoute.POST(request("POST", "/api/tenants", { name: "Initech", sharesWithCustomers: true })));

        expect(status).toBe(201);
        expect(body.data).toEqual({ id: "t-new", name: "Initech" });
        expect(mocks.tenants.create).toHaveBeenCalledWith("Initech", true);
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "TENANT", { name: "Initech", sharesWithCustomers: true }, "t-new", { tenantId: HOME_TENANT_ID, apiKeyId: "key-root" });
    });

    it("creates no tenant for a platform group of some tenants, which would never reach it", async () => {
        mocks.ctx = ninaKey();
        const { status, body } = await json(await tenantsRoute.POST(request("POST", "/api/tenants", { name: "Initech" })));

        expect(status).toBe(403);
        expect(body.error).toMatch(/reaches some tenants only/);
        expect(mocks.tenants.create).not.toHaveBeenCalled();
    });

    it("turns away a name that is no name", async () => {
        mocks.ctx = rootKey();
        expect((await tenantsRoute.POST(request("POST", "/api/tenants", { name: " " }))).status).toBe(400);
        expect((await tenantsRoute.POST(request("POST", "/api/tenants", { name: "x".repeat(61) }))).status).toBe(400);
    });
});

describe("one tenant through the API", () => {
    it("reads a tenant beyond the platform group of the owner as gone, and changes nothing of it", async () => {
        mocks.ctx = ninaKey();
        expect((await tenantRoute.GET(request("GET", "/api/tenants/globex"), params({ id: "globex" }))).status).toBe(404);
        const patched = await json(await tenantRoute.PATCH(request("PATCH", "/api/tenants/globex", { name: "Globex AG" }), params({ id: "globex" })));
        expect(patched).toEqual({ status: 404, body: { success: false, error: "The tenant no longer exists.", data: { saved: [] } } });
        expect((await tenantRoute.DELETE(request("DELETE", "/api/tenants/globex?confirmed=true"), params({ id: "globex" }))).status).toBe(404);
        expect(mocks.tenants.rename).not.toHaveBeenCalled();
        expect(mocks.tenants.delete).not.toHaveBeenCalled();
    });

    it("saves the settings of the Edit dialog in order, each into the logs it belongs to with the key", async () => {
        mocks.ctx = ninaKey();
        const { status, body } = await json(await tenantRoute.PATCH(request("PATCH", "/api/tenants/acme", {
            name: "Acme AG",
            sharesWithCustomers: true,
            allowances: { databases: false },
            onDemandPerDay: 3,
            network: { blocks: true, allowed: ["10.10.0.0/16"] },
        }), params({ id: "acme" })));

        expect(status).toBe(200);
        expect(body.data.saved).toEqual(["name", "sharesWithCustomers", "allowances", "onDemandPerDay", "network"]);
        expect(mocks.tenants.rename).toHaveBeenCalledWith("acme", "Acme AG");
        expect(mocks.tenants.setSharing).toHaveBeenCalledWith("acme", true);
        expect(mocks.setAllowances).toHaveBeenCalledWith("acme", { databases: false });
        expect(mocks.onDemand.set).toHaveBeenCalledWith("acme", 3);
        expect(mocks.setNetwork).toHaveBeenCalledWith("acme", { blocks: true, allowed: ["10.10.0.0/16"] });
        const platform = { tenantId: HOME_TENANT_ID, apiKeyId: "key-nina" };
        const tenant = { tenantId: "acme", apiKeyId: "key-nina" };
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", { name: "Acme AG", renamedFrom: "Acme" }, "acme", platform);
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", { name: "Acme", change: "Shares with customers" }, "acme", platform);
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", expect.objectContaining({ changes: [{ field: "Adds database connections", from: "Yes", to: "No" }] }), "acme", tenant);
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "TENANT", expect.objectContaining({ changes: [expect.objectContaining({ field: "Allowed ranges" })] }), "acme", tenant);
    });

    it("stops at the first refusal and names what it saved before", async () => {
        mocks.ctx = rootKey();
        const { status, body } = await json(await tenantRoute.PATCH(request("PATCH", "/api/tenants/default", { name: "Platform", network: { blocks: true, allowed: [] } }), params({ id: HOME_TENANT_ID })));

        expect(status).toBe(400);
        expect(body).toEqual({ success: false, error: "The home tenant is the platform and reaches the network of its server.", data: { saved: ["name"] } });
        expect(mocks.setNetwork).not.toHaveBeenCalled();
    });

    it("refuses an unknown setting and a change of nothing", async () => {
        mocks.ctx = rootKey();
        expect((await tenantRoute.PATCH(request("PATCH", "/api/tenants/acme", { color: "red" }), params({ id: "acme" }))).status).toBe(400);
        expect((await tenantRoute.PATCH(request("PATCH", "/api/tenants/acme", {}), params({ id: "acme" }))).status).toBe(400);
    });

    it("deletes a tenant that holds something only once confirmed, and lists what would go", async () => {
        mocks.ctx = ninaKey();
        const unconfirmed = await json(await tenantRoute.DELETE(request("DELETE", "/api/tenants/acme"), params({ id: "acme" })));
        expect(unconfirmed.status).toBe(409);
        expect(unconfirmed.body.data.contents).toEqual(expect.objectContaining({ connections: 2, jobs: 1 }));
        expect(mocks.tenants.delete).not.toHaveBeenCalled();

        const confirmed = await json(await tenantRoute.DELETE(request("DELETE", "/api/tenants/acme?confirmed=true"), params({ id: "acme" })));
        expect(confirmed.status).toBe(200);
        expect(mocks.audit).toHaveBeenCalledWith("nina", "DELETE", "TENANT", expect.objectContaining({ name: "Acme" }), "acme", { tenantId: HOME_TENANT_ID, apiKeyId: "key-nina" });
    });

    it("never deletes the tenant the key works in", async () => {
        mocks.ctx = rootKey();
        const { status, body } = await json(await tenantRoute.DELETE(request("DELETE", "/api/tenants/default?confirmed=true"), params({ id: HOME_TENANT_ID })));
        expect(status).toBe(403);
        expect(body.error).toBe("You work in this tenant. Open another one first.");
    });

    it("keeps a refusal of the service, like a run that still waits, as a conflict", async () => {
        const { ConflictError } = await import("@/lib/logging/errors");
        mocks.ctx = rootKey();
        mocks.tenants.delete.mockRejectedValue(new ConflictError("A run of Acme waits or runs right now."));
        expect((await tenantRoute.DELETE(request("DELETE", "/api/tenants/acme?confirmed=true"), params({ id: "acme" }))).status).toBe(409);
    });
});

// ── Members ──────────────────────────────────────────────────────────────────

describe("the members of a tenant through the API", () => {
    const add = (tenantId: string, body: unknown) => membersRoute.POST(request("POST", `/api/tenants/${tenantId}/members`, body), params({ id: tenantId }));

    it("lists the members with what Add member offers for a key that manages the tenants", async () => {
        mocks.ctx = ninaKey();
        const { status, body } = await json(await membersRoute.GET(request("GET", "/api/tenants/acme/members"), params({ id: "acme" })));

        expect(status).toBe(200);
        expect(body.data.members).toHaveLength(1);
        // The people of the tenants her platform group reaches, never a platform admin.
        expect(body.data.accounts.map((account: { id: string }) => account.id)).toEqual(["tom", "carla"]);
        // Only the groups she may give there.
        expect(body.data.groups).toEqual([{ id: "g-ops", name: "Operators", fullAccess: false }]);
    });

    it("adds an account she sees with a group, into the log of the tenant with the key", async () => {
        mocks.ctx = ninaKey();
        expect((await add("acme", { userId: "carla", groupId: "g-ops" })).status).toBe(200);
        expect(mocks.memberships.setRole).toHaveBeenCalledWith("carla", "acme", "g-ops", { platformAdmin: false });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "USER", { change: "Tenant group set", tenant: "Acme", group: "Operators" }, "carla", { tenantId: "acme", apiKeyId: "key-nina" });
    });

    it("keeps the rules of Platform > Tenants: no tenant beyond the reach, no account she does not see, no group beyond her", async () => {
        mocks.ctx = ninaKey();
        expect((await json(await add("globex", { userId: "carla", groupId: "g-ops" })))).toEqual({ status: 404, body: { success: false, error: "The tenant no longer exists." } });
        expect((await json(await add("acme", { userId: "gina", groupId: "g-ops" }))).body.error).toBe("The account no longer exists.");
        const beyond = await json(await add("acme", { userId: "carla", groupId: "g-admin" }));
        expect(beyond.status).toBe(403);
        expect(beyond.body.error).toMatch(/may do more than you may/);
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("never lets a key change the membership of its owner or of a platform admin, also the key of a platform admin", async () => {
        mocks.ctx = rootKey();
        expect((await json(await add("acme", { userId: "root", groupId: "g-ops" }))).body.error).toBe("Another admin changes your own membership.");
        mocks.ctx = ninaKey();
        mocks.memberships.isPlatformAdmin.mockResolvedValue(true);
        expect((await json(await add("acme", { userId: "carla", groupId: "g-ops" }))).body.error).toBe("Only a platform admin changes the memberships of a platform admin.");
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("changes the group of a member and takes one out of the tenant", async () => {
        mocks.ctx = ninaKey();
        expect((await memberRoute.PATCH(request("PATCH", "/api/tenants/acme/members/tom", { groupId: "g-ops" }), params({ id: "acme", userId: "tom" }))).status).toBe(200);
        expect((await memberRoute.DELETE(request("DELETE", "/api/tenants/acme/members/tom"), params({ id: "acme", userId: "tom" }))).status).toBe(200);
        expect(mocks.memberships.setRole).toHaveBeenLastCalledWith("tom", "acme", null, { platformAdmin: false });
        expect(mocks.audit).toHaveBeenLastCalledWith("nina", "UPDATE", "USER", { change: "Removed from tenant", tenant: "Acme" }, "tom", { tenantId: "acme", apiKeyId: "key-nina" });
        expect((await memberRoute.PATCH(request("PATCH", "/api/tenants/acme/members/tom", {}), params({ id: "acme", userId: "tom" }))).status).toBe(400);
    });

    it("lets a key of the tenant itself with users:* look after its own people, never another tenant", async () => {
        mocks.ctx = tomKey([P.USERS.READ, P.USERS.WRITE, P.JOBS.READ]);
        const listed = await json(await membersRoute.GET(request("GET", "/api/tenants/acme/members"), params({ id: "acme" })));
        expect(listed.body.data).toEqual({ members: expect.any(Array) });

        expect((await add("acme", { userId: "carla", groupId: "g-ops" })).status).toBe(200);
        expect(mocks.audit).toHaveBeenCalledWith("tom", "UPDATE", "USER", { change: "Tenant group set", tenant: "Acme", group: "Operators" }, "carla", { tenantId: "acme", apiKeyId: "key-tom" });

        expect((await membersRoute.GET(request("GET", "/api/tenants/globex/members"), params({ id: "globex" }))).status).toBe(403);
        expect((await add("globex", { userId: "carla", groupId: "g-ops" })).status).toBe(403);
    });

    it("adds nobody of another tenant through a key of the tenant, who joins by an invitation", async () => {
        mocks.ctx = tomKey([P.USERS.READ, P.USERS.WRITE]);
        const { status, body } = await json(await add("acme", { userId: "gina", groupId: "g-ops" }));
        expect(status).toBe(403);
        expect(body.error).toMatch(/Add people to this tenant with an invitation/);
    });

    it("gives no group beyond what the key holds, and needs users:write to change anything", async () => {
        mocks.ctx = tomKey([P.USERS.WRITE]);
        // Operators may see the users, which this key may not.
        expect((await add("acme", { userId: "carla", groupId: "g-ops" })).status).toBe(403);
        mocks.ctx = tomKey([P.USERS.READ]);
        expect((await add("acme", { userId: "carla", groupId: "g-ops" })).status).toBe(403);
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("says All tenants only reads to a session there without the platform right", async () => {
        mocks.ctx = { ...rootSession(null), permissions: [P.USERS.READ, P.USERS.WRITE], isPlatformAdmin: false };
        const { status, body } = await json(await add("acme", { userId: "carla", groupId: "g-ops" }));
        expect(status).toBe(403);
        expect(body.error).toMatch(/All tenants only reads/);
    });
});

// ── Invitations ──────────────────────────────────────────────────────────────

describe("the invitations of a tenant through the API", () => {
    const invite = (tenantId: string, body: unknown) => invitationsRoute.POST(request("POST", `/api/tenants/${tenantId}/invitations`, body), params({ id: tenantId }));

    it("makes a link for a key of the tenant, handing the token back once", async () => {
        mocks.ctx = tomKey([P.USERS.READ, P.USERS.WRITE]);
        const { status, body } = await json(await invite("acme", { groupId: "g-ops", days: 7, note: "New hire" }));

        expect(status).toBe(201);
        expect(body.data).toEqual(expect.objectContaining({ id: "inv-1", token: "t".repeat(43), path: `/invite?token=${"t".repeat(43)}`, group: { id: "g-ops", name: "Operators" } }));
        expect(mocks.invitations.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "acme", groupId: "g-ops", days: 7, note: "New hire", createdById: "tom" }));
        expect(mocks.audit).toHaveBeenCalledWith("tom", "CREATE", "TENANT", { change: "Invitation created", group: "Operators", note: "New hire" }, "acme", { tenantId: "acme", apiKeyId: "key-tom" });
    });

    it("makes a link of a tenant the platform group reaches, capped by what the owner may there", async () => {
        mocks.ctx = ninaKey();
        expect((await invite("acme", { groupId: "g-ops" })).status).toBe(201);
        expect(mocks.users.permissionsIn).toHaveBeenCalledWith("nina", "acme");
        expect((await invite("acme", { groupId: "g-admin" })).status).toBe(403);
        expect((await invite("globex", { groupId: "g-ops" })).status).toBe(404);
        expect(mocks.invitations.create).toHaveBeenCalledTimes(1);
    });

    it("lists the open links and revokes one, which a second time is gone", async () => {
        const { NotFoundError } = await import("@/lib/logging/errors");
        mocks.ctx = tomKey([P.USERS.READ, P.USERS.WRITE]);
        expect((await json(await invitationsRoute.GET(request("GET", "/api/tenants/acme/invitations"), params({ id: "acme" })))).body.data).toHaveLength(1);
        expect((await invitationRoute.DELETE(request("DELETE", "/api/tenants/acme/invitations/inv-1"), params({ id: "acme", invitationId: "inv-1" }))).status).toBe(200);
        expect(mocks.invitations.revoke).toHaveBeenCalledWith("inv-1", "acme");
        expect(mocks.audit).toHaveBeenCalledWith("tom", "DELETE", "TENANT", { change: "Invitation revoked", group: "Operators", note: "New hire" }, "acme", { tenantId: "acme", apiKeyId: "key-tom" });

        mocks.invitations.revoke.mockRejectedValue(new NotFoundError("Invitation", "inv-1"));
        expect((await invitationRoute.DELETE(request("DELETE", "/api/tenants/acme/invitations/inv-1"), params({ id: "acme", invitationId: "inv-1" }))).status).toBe(404);
    });

    it("refuses a key that may only read the users and a key of another tenant", async () => {
        mocks.ctx = tomKey([P.USERS.READ]);
        expect((await invite("acme", { groupId: "g-ops" })).status).toBe(403);
        mocks.ctx = tomKey([P.USERS.READ, P.USERS.WRITE]);
        expect((await invitationsRoute.GET(request("GET", "/api/tenants/globex/invitations"), params({ id: "globex" }))).status).toBe(403);
        expect(mocks.invitations.create).not.toHaveBeenCalled();
    });

    it("turns away more days than a link may work", async () => {
        mocks.ctx = tomKey([P.USERS.READ, P.USERS.WRITE]);
        expect((await invite("acme", { groupId: "g-ops", days: 31 })).status).toBe(400);
    });
});

// ── Sharing ──────────────────────────────────────────────────────────────────

describe("sharing a destination or a channel through the API", () => {
    const SETTINGS = { allTenants: false, tenantIds: ["acme"], encryptedOnly: true, ownRecipients: true };
    const put = (body: unknown) => shareRoute.PUT(request("PUT", "/api/adapters/nas/share", body), params({ id: "nas" }));

    beforeEach(() => {
        mocks.shares.view.mockResolvedValue({ kind: "destination", uses: [{ name: "Acme" }], settings: SETTINGS });
        mocks.shares.losing.mockResolvedValue([]);
        mocks.shares.save.mockResolvedValue({ name: "NAS", kind: "destination", gained: ["Acme"], losses: [] });
    });

    it("reads and changes the sharing with the reach of the owner, into the log with the key", async () => {
        mocks.ctx = ninaSharingKey();
        expect((await shareRoute.GET(request("GET", "/api/adapters/nas/share"), params({ id: "nas" }))).status).toBe(200);
        expect(mocks.shares.view).toHaveBeenCalledWith("nas", ["acme"]);

        const { status, body } = await json(await put(SETTINGS));
        expect(status).toBe(200);
        expect(body.data).toEqual({ gained: ["Acme"], lost: [] });
        expect(mocks.shares.save).toHaveBeenCalledWith("nas", SETTINGS, { confirmed: false, reach: ["acme"] });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "DESTINATION", { name: "NAS", action: "share", tenants: "Acme" }, "nas", { apiKeyId: "key-nina" });
    });

    it("asks for confirmed while a tenant would lose the destination with its backups", async () => {
        mocks.ctx = ninaSharingKey();
        mocks.shares.losing.mockResolvedValue([{ tenantId: "acme", name: "Acme", backups: 4, jobs: ["Nightly"] }]);
        const { status, body } = await json(await put({ ...SETTINGS, tenantIds: [] }));

        expect(status).toBe(409);
        expect(body.data.losing).toEqual([expect.objectContaining({ name: "Acme", backups: 4 })]);
        expect(mocks.shares.save).not.toHaveBeenCalled();
        expect((await put({ ...SETTINGS, tenantIds: [], confirmed: true })).status).toBe(200);
    });

    it("refuses a key without the right, a key of a customer and All tenants", async () => {
        mocks.ctx = tomKey([P.DESTINATIONS.WRITE, P.PLATFORM.SHARING_WRITE]);
        expect((await put(SETTINGS)).status).toBe(403);
        mocks.ctx = rootSession(null);
        const allTenants = await json(await put(SETTINGS));
        expect(allTenants.status).toBe(403);
        expect(allTenants.body.error).toMatch(/All tenants only reads/);
        expect(mocks.shares.save).not.toHaveBeenCalled();
    });
});

// ── Rules of a shared server ─────────────────────────────────────────────────

describe("the rules of a shared server through the API", () => {
    it("lists, adds and ends rules with the reach of the owner, into the log with the key", async () => {
        mocks.ctx = ninaSharingKey();
        mocks.assignments.forSource.mockResolvedValue({ rules: [{ id: "r-1", pattern: "shop_*" }] });
        mocks.assignments.addRule.mockResolvedValue({ id: "r-2", pattern: "acme_*", tenantId: "acme", tenantName: "Acme", onDemandPerDay: null });
        mocks.assignments.removeRule.mockResolvedValue({ pattern: "acme_*", tenantName: "Acme" });

        expect((await json(await rulesRoute.GET(request("GET", "/api/adapters/srv/database-assignments/rules"), params({ id: "srv" })))).body.data).toEqual([{ id: "r-1", pattern: "shop_*" }]);
        expect((await rulesRoute.POST(request("POST", "/api/adapters/srv/database-assignments/rules", { pattern: "acme_*", tenantId: "acme", priority: 5 }), params({ id: "srv" }))).status).toBe(201);
        expect(mocks.assignments.addRule).toHaveBeenCalledWith("srv", { pattern: "acme_*", tenantId: "acme", priority: 5 }, expect.any(Date), ["acme"]);
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "ADAPTER", { change: "Assignment rule added", pattern: "acme_*", tenant: "Acme" }, "srv", { apiKeyId: "key-nina" });

        expect((await ruleRoute.DELETE(request("DELETE", "/api/adapters/srv/database-assignments/rules/r-2"), params({ id: "srv", ruleId: "r-2" }))).status).toBe(200);
        expect(mocks.assignments.removeRule).toHaveBeenCalledWith("srv", "r-2", expect.any(Date), ["acme"]);
        expect(mocks.audit).toHaveBeenLastCalledWith("nina", "UPDATE", "ADAPTER", { change: "Assignment rule removed", pattern: "acme_*", tenant: "Acme" }, "srv", { apiKeyId: "key-nina" });
    });

    it("hands on the refusal of a tenant beyond the reach as a bad request", async () => {
        const { ValidationError } = await import("@/lib/logging/errors");
        mocks.ctx = ninaSharingKey();
        mocks.assignments.addRule.mockRejectedValue(new ValidationError("Globex is beyond your platform group."));
        const { status, body } = await json(await rulesRoute.POST(request("POST", "/api/adapters/srv/database-assignments/rules", { pattern: "g_*", tenantId: "globex" }), params({ id: "srv" })));
        expect(status).toBe(400);
        expect(body.error).toBe("Globex is beyond your platform group.");
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("changes no rule from All tenants or without the right to share", async () => {
        mocks.ctx = rootSession(null);
        expect((await rulesRoute.POST(request("POST", "/api/adapters/srv/database-assignments/rules", { pattern: "g_*", tenantId: "globex" }), params({ id: "srv" }))).status).toBe(403);
        mocks.ctx = tomKey([P.SOURCES.WRITE]);
        expect((await ruleRoute.DELETE(request("DELETE", "/api/adapters/srv/database-assignments/rules/r-2"), params({ id: "srv", ruleId: "r-2" }))).status).toBe(403);
        expect(mocks.assignments.addRule).not.toHaveBeenCalled();
        expect(mocks.assignments.removeRule).not.toHaveBeenCalled();
    });
});
