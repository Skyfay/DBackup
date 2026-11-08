import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

interface TestViewer {
    id: string;
    name: string;
    email: string;
    isPlatformAdmin: boolean;
    tenantId: string | null;
    permissions: string[];
    role: { id: string; name: string } | null;
    allTenants?: boolean;
}

const mocks = vi.hoisted(() => ({
    denied: new Set<string>(),
    viewer: null as unknown as TestViewer,
    groups: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), find: vi.fn(), heldBy: vi.fn(), holdsPlatformAdmin: vi.fn(), namesOf: vi.fn(), memberIds: vi.fn(async (..._args: unknown[]): Promise<string[]> => []) },
    /** Why a membership may not end, see `membershipEndRefusal`, by the account. */
    endRefused: new Set<string>(),
    memberships: { roleOf: vi.fn(), setRoles: vi.fn(), isPersonOf: vi.fn(async (..._args: unknown[]) => true), isPlatformAdmin: vi.fn(async () => false) },
    users: { namesOf: vi.fn(), accountOf: vi.fn(), permissionsIn: vi.fn(async (..._args: unknown[]): Promise<string[]> => []) },
    /** The tenants the platform group of the viewer reaches. */
    reach: [] as string[],
    audit: vi.fn(),
    /** The accounts the viewer sees, see `maySeeAccount`. */
    seen: new Set<string>(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (mocks.denied.has(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
    getViewer: vi.fn(async () => mocks.viewer),
    hasPermissionWithContext: (ctx: TestViewer, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/user/group-service", () => ({ groupService: mocks.groups }));
vi.mock("@/services/tenant/membership-service", () => ({ membershipService: mocks.memberships }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.users }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reachOf: vi.fn(async () => mocks.reach) } }));
vi.mock("@/services/user/account-visibility", () => ({ maySeeAccount: vi.fn(async (_viewer: unknown, id: string) => mocks.seen.has(id)) }));
vi.mock("@/services/tenant/membership-end", () => ({
    MEMBERSHIP_END_HANDS_OVER: "hands over",
    membershipEndRefusal: vi.fn(async (_caller: unknown, id: string) => (mocks.endRefused.has(id) ? "hands over" : null)),
}));

const { bulkDeleteGroups, createGroup, deleteGroup, moveUsersToGroup, updateGroup } = await import("@/app/actions/auth/group");

const ALL = AVAILABLE_PERMISSIONS.map((permission) => permission.id);

/** Manages the groups and the users of the home tenant, without every permission. */
const ADMIN: TestViewer = {
    id: "admin",
    name: "Ada",
    email: "ada@example.ch",
    isPlatformAdmin: false,
    tenantId: HOME_TENANT_ID,
    permissions: [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE, PERMISSIONS.GROUPS.READ, PERMISSIONS.GROUPS.WRITE, PERMISSIONS.JOBS.READ],
    role: { id: "g-admins", name: "Admins" },
};
const PLATFORM_ADMIN: TestViewer = { id: "root", name: "Root", email: "root@example.ch", isPlatformAdmin: true, tenantId: HOME_TENANT_ID, permissions: ALL, role: null };
/** The admin of a customer, with every permission of the tenant and none of the instance's settings. */
const CUSTOMER_ADMIN: TestViewer = {
    ...ADMIN,
    id: "lena",
    name: "Lena",
    tenantId: "t-acme",
    permissions: ALL.filter((permission) => !permission.startsWith("settings:")),
};
/** A platform admin in All tenants, which changes no tenant. */
const IN_ALL_TENANTS: TestViewer = { ...PLATFORM_ADMIN, tenantId: null, allTenants: true };

const VIEWERS = { id: "g-view", name: "Viewers", permissions: JSON.stringify([PERMISSIONS.JOBS.READ]), fullAccess: false };
const FULL_ACCESS = { id: "g-full", name: "Admin", permissions: "[]", fullAccess: true };
const SETTINGS_ADMINS = { id: "g-settings", name: "Settings admins", permissions: JSON.stringify([PERMISSIONS.SETTINGS.WRITE]), fullAccess: false };
const DELETERS = { id: "g-deleters", name: "Deleters", permissions: JSON.stringify([PERMISSIONS.STORAGE.READ, PERMISSIONS.STORAGE.DELETE]), fullAccess: false };
const OPERATORS = { id: "g-ops", name: "Operators", permissions: JSON.stringify([PERMISSIONS.JOBS.READ]), fullAccess: false };

const GROUP_BEYOND = "This group may do more than you may, so only someone who may do all of it changes it.";
const GROUP_TOO_STRONG = "This group may do more than you may, so you cannot give it to anyone.";
const MOVE_TOO_STRONG = "This group may do more than you may, so you cannot move anyone into it.";
const MEMBER_TOO_STRONG = "This user's group may do more than you may, so only someone who may do all of it changes it.";
const OPEN_A_TENANT = "Open a tenant to change its groups.";

function reset(viewer: TestViewer) {
    vi.clearAllMocks();
    mocks.denied = new Set();
    mocks.viewer = viewer;
    mocks.groups.heldBy.mockResolvedValue(false);
    mocks.groups.holdsPlatformAdmin.mockResolvedValue(false);
    mocks.groups.delete.mockResolvedValue({ name: "Operators", moved: 2, ssoProviders: [] });
    mocks.groups.create.mockImplementation(async (input: { name: string; permissions: string[] }) => ({ id: "g-new", ...input }));
    mocks.groups.update.mockResolvedValue({ name: "Operators", added: [], removed: [], areas: [] });
    mocks.groups.deleteMany.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [], ssoProviders: [] }));
    mocks.groups.find.mockImplementation(async (id: string) => [VIEWERS, FULL_ACCESS, SETTINGS_ADMINS, DELETERS, OPERATORS].find((group) => group.id === id) ?? null);
    mocks.groups.namesOf.mockImplementation(async (ids: string[]) => new Map([VIEWERS, FULL_ACCESS, SETTINGS_ADMINS, DELETERS, OPERATORS].filter((group) => ids.includes(group.id)).map((group) => [group.id, group.name])));
    mocks.memberships.roleOf.mockResolvedValue(VIEWERS);
    mocks.memberships.setRoles.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
    mocks.users.namesOf.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, name: id === "root" ? "Root" : id })));
    mocks.groups.memberIds.mockResolvedValue([]);
    mocks.users.accountOf.mockResolvedValue(null);
    mocks.users.permissionsIn.mockResolvedValue([]);
    mocks.reach = [];
    mocks.endRefused = new Set();
}

describe("what may be done to groups and their people", () => {
    beforeEach(() => reset(ADMIN));

    it("keeps the template of a new group in the audit log of the tenant", async () => {
        expect(await createGroup({ name: "Operators", permissions: ["jobs:read"], template: "operator" })).toEqual({ success: true, data: { id: "g-new" } });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "CREATE", "GROUP", { name: "Operators", permissions: ["jobs:read"], template: "operator" }, "g-new");
    });

    it("writes what an edit changed to the audit log, not the whole list", async () => {
        const change = { name: "Ops", added: ["jobs:read"], removed: [], areas: [{ area: "jobs", from: "none", to: "see" }] };
        mocks.groups.update.mockResolvedValue(change);

        expect(await updateGroup("g-ops", { name: "Ops", permissions: ["jobs:read"] })).toEqual({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "GROUP", change, "g-ops");
    });

    it("never changes the group of the one who changes it, which would hand them any permission", async () => {
        mocks.groups.heldBy.mockResolvedValue(true);
        expect(await updateGroup("g-admins", { name: "Admins", permissions: ["users:write"] })).toEqual({
            success: false,
            error: "You are in this group. Another admin changes it.",
        });
        expect(mocks.groups.update).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("deletes a group and moves its members to the picked one", async () => {
        expect(await deleteGroup("g-ops", "g-view")).toEqual({ success: true, data: { moved: 2 } });
        expect(mocks.groups.delete).toHaveBeenCalledWith("g-ops", "g-view", { platformAdmin: false }, []);
        expect(mocks.audit).toHaveBeenCalledWith("admin", "DELETE", "GROUP", { name: "Operators", moved: 2, moveTo: "g-view" }, "g-ops");
    });

    it("writes each sign-in provider the delete sent elsewhere into the log of the platform, like an edit of the provider", async () => {
        mocks.groups.delete.mockResolvedValue({
            name: "Operators",
            moved: 2,
            ssoProviders: [
                { id: "sso-acme", name: "Acme Entra", tenantId: "acme", before: { group: "Operators", allowProvisioning: true }, after: { group: null, allowProvisioning: false } },
                { id: "sso-staff", name: "Staff", tenantId: null, before: { group: "Operators", allowProvisioning: true }, after: { group: null, allowProvisioning: true } },
            ],
        });

        expect(await deleteGroup("g-ops", null)).toEqual({ success: true, data: { moved: 2 } });

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", {
            name: "Acme Entra",
            changes: [
                { field: "Group of new people", from: "Operators", to: null },
                { field: "Adds new people", from: "On", to: "Off" },
            ],
            // The tenant of the provider by its id, so the log of the platform hides it from whoever does not reach it.
            tenantId: "acme",
        }, "sso-acme", { tenantId: HOME_TENANT_ID });
        // A provider of the platform names no tenant, so every reader of the log of the platform sees it.
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", {
            name: "Staff",
            changes: [{ field: "Group of new people", from: "Operators", to: null }],
        }, "sso-staff", { tenantId: HOME_TENANT_ID });
    });

    it("writes the sign-in providers a bulk delete changed into the log of the platform", async () => {
        mocks.groups.deleteMany.mockImplementation(async (ids: string[]) => ({
            succeeded: ids,
            failed: [],
            ssoProviders: [{ id: "sso-acme", name: "Acme Entra", tenantId: "acme", before: { group: "Operators", allowProvisioning: true }, after: { group: null, allowProvisioning: false } }],
        }));

        await bulkDeleteGroups(["g-ops"]);

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", {
            name: "Acme Entra",
            changes: [
                { field: "Group of new people", from: "Operators", to: null },
                { field: "Adds new people", from: "On", to: "Off" },
            ],
            // The tenant of the provider by its id, so the log of the platform hides it from whoever does not reach it.
            tenantId: "acme",
        }, "sso-acme", { tenantId: HOME_TENANT_ID });
    });

    it("hands the members it checked to the delete, which stops when someone joined since", async () => {
        mocks.groups.memberIds.mockResolvedValue(["lena", "tech"]);
        const { ConflictError } = await import("@/lib/logging/errors");
        mocks.groups.delete.mockRejectedValueOnce(new ConflictError("The members of this group changed meanwhile, try again."));

        expect(await deleteGroup("g-ops", null)).toEqual({ success: false, error: "The members of this group changed meanwhile, try again." });
        expect(mocks.groups.delete).toHaveBeenCalledWith("g-ops", null, { platformAdmin: false }, ["lena", "tech"]);
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("deletes a group without a group for its members, which takes them out of the tenant", async () => {
        expect(await deleteGroup("g-ops", null)).toEqual({ success: true, data: { moved: 2 } });
        expect(mocks.groups.delete).toHaveBeenCalledWith("g-ops", null, { platformAdmin: false }, []);
    });

    it("tells the service who changes a group, so only a platform admin skips the guard that keeps a manager", async () => {
        expect(await updateGroup("g-ops", { name: "Ops", permissions: ["jobs:read"] })).toEqual({ success: true });
        expect(mocks.groups.update).toHaveBeenLastCalledWith("g-ops", { name: "Ops", permissions: ["jobs:read"] }, { platformAdmin: false });

        mocks.viewer = PLATFORM_ADMIN;
        expect(await updateGroup("g-ops", { name: "Ops", permissions: ["jobs:read"] })).toEqual({ success: true });
        expect(await deleteGroup("g-ops", null)).toEqual({ success: true, data: { moved: 2 } });
        expect(mocks.groups.update).toHaveBeenLastCalledWith("g-ops", { name: "Ops", permissions: ["jobs:read"] }, { platformAdmin: true });
        expect(mocks.groups.delete).toHaveBeenLastCalledWith("g-ops", null, { platformAdmin: true }, undefined);
    });

    it("never deletes a group a platform admin is in unless a platform admin deletes it, since that moves or ends their membership", async () => {
        mocks.groups.holdsPlatformAdmin.mockResolvedValue(true);

        expect(await deleteGroup("g-ops", "g-view")).toEqual({ success: false, error: "A platform admin is in this group, so only a platform admin deletes it." });
        expect(await deleteGroup("g-ops", null)).toEqual({ success: false, error: "A platform admin is in this group, so only a platform admin deletes it." });
        expect(mocks.groups.delete).not.toHaveBeenCalled();

        mocks.viewer = PLATFORM_ADMIN;
        expect(await deleteGroup("g-ops", null)).toEqual({ success: true, data: { moved: 2 } });
    });

    it("never deletes the group of the one who deletes", async () => {
        mocks.groups.heldBy.mockResolvedValue(true);

        expect(await deleteGroup("g-admins", null)).toEqual({ success: false, error: "You are in this group. Another admin deletes it." });
        expect(mocks.groups.heldBy).toHaveBeenCalledWith("g-admins", "admin");
        expect(mocks.groups.delete).not.toHaveBeenCalled();
    });

    it("never moves members into a group that may do more than the one who moves them", async () => {
        expect(await deleteGroup("g-ops", "g-full")).toEqual({ success: false, error: MOVE_TOO_STRONG });
        expect(await moveUsersToGroup(["lena"], "g-full")).toEqual({ success: false, error: GROUP_TOO_STRONG });
        // One permission the mover lacks is enough, the settings of the instance too.
        expect(await deleteGroup("g-ops", "g-settings")).toEqual({ success: false, error: MOVE_TOO_STRONG });
        expect(await moveUsersToGroup(["lena"], "g-settings")).toEqual({ success: false, error: GROUP_TOO_STRONG });
        expect(mocks.groups.delete).not.toHaveBeenCalled();
        expect(mocks.memberships.setRoles).not.toHaveBeenCalled();
    });

    it("lets a platform admin move members into the full access group", async () => {
        mocks.viewer = PLATFORM_ADMIN;

        expect(await deleteGroup("g-ops", "g-full")).toEqual({ success: true, data: { moved: 2 } });
        expect((await moveUsersToGroup(["lena"], "g-full")).success).toBe(true);
        expect(mocks.memberships.setRoles).toHaveBeenCalledWith(["lena"], HOME_TENANT_ID, "g-full", { platformAdmin: true });
    });

    it("refuses to move people into a group that is gone", async () => {
        expect(await moveUsersToGroup(["lena"], "g-gone")).toEqual({ success: false, error: "The group no longer exists." });
        expect(mocks.memberships.setRoles).not.toHaveBeenCalled();
    });

    it("moves people in the own tenant but reports the own account and those whose group may do more", async () => {
        mocks.memberships.roleOf.mockImplementation(async (id: string) => (id === "root" ? FULL_ACCESS : VIEWERS));

        const result = await moveUsersToGroup(["lena", "admin", "root"], "g-view");

        expect(mocks.memberships.setRoles).toHaveBeenCalledWith(["lena"], HOME_TENANT_ID, "g-view", { platformAdmin: false });
        expect(result).toEqual({
            success: true,
            data: {
                succeeded: ["lena"],
                failed: [
                    { id: "admin", name: "Ada", error: "You cannot change your own group." },
                    { id: "root", name: "Root", error: MEMBER_TOO_STRONG },
                ],
            },
        });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "USER", { change: "Updating Group", name: "lena", groupId: "g-view", group: "Viewers" }, "lena");
    });

    it("says why a platform admin who works here stays in their group", async () => {
        mocks.memberships.isPlatformAdmin.mockImplementation(async (...args: unknown[]) => args[0] === "root");
        try {
            const result = await moveUsersToGroup(["lena", "root"], "g-view");

            expect(mocks.memberships.setRoles).toHaveBeenCalledWith(["lena"], HOME_TENANT_ID, "g-view", { platformAdmin: false });
            expect(result).toEqual({ success: true, data: { succeeded: ["lena"], failed: [{ id: "root", name: "Root", error: "Only a platform admin changes the memberships of a platform admin." }] } });
        } finally {
            mocks.memberships.isPlatformAdmin.mockImplementation(async () => false);
        }
    });

    it("never takes someone out of the tenant when they would then work alone where the viewer manages the users", async () => {
        mocks.endRefused = new Set(["tech"]);

        const result = await moveUsersToGroup(["lena", "tech"], null);
        expect(mocks.memberships.setRoles).toHaveBeenCalledWith(["lena"], HOME_TENANT_ID, null, { platformAdmin: false });
        expect(result).toEqual({ success: true, data: { succeeded: ["lena"], failed: [{ id: "tech", name: "tech", error: "hands over" }] } });

        // Moving them to another group ends no membership.
        expect((await moveUsersToGroup(["tech"], "g-view")).data?.succeeded).toEqual(["tech"]);

        // Nor through the delete of their group without a group to go to.
        mocks.groups.memberIds.mockResolvedValue(["lena", "tech"]);
        expect(await deleteGroup("g-ops", null)).toEqual({ success: false, error: expect.stringContaining("would afterwards work only in tenants where you manage the users") });
        expect(mocks.groups.delete).not.toHaveBeenCalled();
        expect(await deleteGroup("g-ops", "g-view")).toEqual({ success: true, data: { moved: 2 } });
    });

    it("names an account of another tenant only while the viewer may see it, and answers any other like one that does not exist", async () => {
        mocks.memberships.isPersonOf.mockImplementation(async (...args: unknown[]) => args[0] === "lena");
        mocks.users.namesOf.mockImplementation(async (ids: string[]) => ids.filter((id) => id !== "gone").map((id) => ({ id, name: id === "gina" ? "Gina Globex" : id === "tech" ? "Tom Tech" : id })));
        mocks.seen = new Set(["tech"]);
        try {
            const result = await moveUsersToGroup(["lena", "gina", "tech", "gone"], "g-view");

            expect(result).toEqual({
                success: true,
                data: {
                    succeeded: ["lena"],
                    failed: [
                        { id: "gina", name: "gina", error: "The user no longer exists." },
                        { id: "tech", name: "Tom Tech", error: "This account works in another tenant. Add people to this tenant with an invitation." },
                        { id: "gone", name: "gone", error: "The user no longer exists." },
                    ],
                },
            });
            expect(JSON.stringify(result)).not.toContain("Gina Globex");
        } finally {
            mocks.memberships.isPersonOf.mockImplementation(async () => true);
            mocks.seen = new Set();
        }
    });

    it("never moves an account of no tenant into the home tenant when the provider of another tenant claims its email", async () => {
        mocks.users.accountOf.mockImplementation(async (id: string) => (id === "claimed" ? { isPlatformAdmin: false, tenantIds: ["t-acme"], platformGroup: null, groups: [] } : null));
        mocks.seen = new Set(["claimed"]);
        try {
            const result = await moveUsersToGroup(["lena", "claimed"], "g-view");

            expect(result.data?.succeeded).toEqual(["lena"]);
            expect(result.data?.failed).toEqual([{ id: "claimed", name: "claimed", error: "This account works in another tenant. Add people to this tenant with an invitation." }]);
            expect(mocks.memberships.setRoles).toHaveBeenCalledWith(["lena"], HOME_TENANT_ID, "g-view", { platformAdmin: false });
        } finally {
            mocks.seen = new Set();
        }
    });

    it("moves such an account in for someone whose rights of the platform reach the tenant that claims it", async () => {
        mocks.users.accountOf.mockImplementation(async (id: string) => (id === "claimed" ? { isPlatformAdmin: false, tenantIds: ["t-acme"], platformGroup: null, groups: [] } : null));
        mocks.users.permissionsIn.mockResolvedValue([PERMISSIONS.PLATFORM.ACCOUNTS_WRITE]);
        mocks.reach = [HOME_TENANT_ID, "t-acme"];

        expect((await moveUsersToGroup(["claimed"], "g-view")).data?.succeeded).toEqual(["claimed"]);
        expect(mocks.memberships.setRoles).toHaveBeenCalledWith(["claimed"], HOME_TENANT_ID, "g-view", { platformAdmin: false });
    });

    it("deletes a group with members only for someone who may also manage users, since its members move", async () => {
        mocks.viewer = { ...ADMIN, permissions: ADMIN.permissions.filter((permission) => permission !== PERMISSIONS.USERS.WRITE) };
        mocks.groups.memberIds.mockResolvedValue(["lena"]);

        expect(await deleteGroup("g-ops", "g-view")).toEqual({ success: false, error: "People are in this group, and moving them takes the right to manage users." });
        expect(await deleteGroup("g-ops", null)).toEqual({ success: false, error: "People are in this group, and moving them takes the right to manage users." });
        expect(mocks.groups.delete).not.toHaveBeenCalled();

        // An empty group moves nobody.
        mocks.groups.memberIds.mockResolvedValue([]);
        expect(await deleteGroup("g-ops", null)).toEqual({ success: true, data: { moved: 2 } });
    });

    it("needs the right to change groups, and to change users for moving people", async () => {
        mocks.denied = new Set(["groups:write", "users:write"]);

        await expect(createGroup({ name: "Ops", permissions: [] })).rejects.toBeInstanceOf(PermissionError);
        await expect(deleteGroup("g-ops", null)).rejects.toBeInstanceOf(PermissionError);
        await expect(moveUsersToGroup(["lena"], null)).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.groups.create).not.toHaveBeenCalled();
        expect(mocks.groups.delete).not.toHaveBeenCalled();
        expect(mocks.memberships.setRoles).not.toHaveBeenCalled();
    });
});

describe("the permissions a group may get", () => {
    beforeEach(() => reset(ADMIN));

    it("never makes a group that may do more than its maker", async () => {
        const result = await createGroup({ name: "Deleters", permissions: [PERMISSIONS.JOBS.READ, PERMISSIONS.STORAGE.DELETE] });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/^A group can only get what you may do yourself\. You may not: /);
        expect(mocks.groups.create).not.toHaveBeenCalled();
    });

    it("never edits a group to hold more than the editor holds", async () => {
        const result = await updateGroup("g-ops", { name: "Operators", permissions: [PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE] });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/You may not: /);
        expect(mocks.groups.update).not.toHaveBeenCalled();
    });

    it("never changes or deletes a group that may already do more than the one who asks", async () => {
        expect(await updateGroup("g-deleters", { name: "Deleters", permissions: [PERMISSIONS.JOBS.READ] })).toEqual({ success: false, error: GROUP_BEYOND });
        expect(await deleteGroup("g-deleters", null)).toEqual({ success: false, error: GROUP_BEYOND });
        expect(mocks.groups.update).not.toHaveBeenCalled();
        expect(mocks.groups.delete).not.toHaveBeenCalled();
    });

    it("leaves a group that may do more out of a bulk delete, with why", async () => {
        const result = await bulkDeleteGroups(["g-ops", "g-deleters"]);

        expect(mocks.groups.deleteMany).toHaveBeenCalledWith(["g-ops"]);
        expect(result).toEqual({ success: true, data: { succeeded: ["g-ops"], failed: [{ id: "g-deleters", name: "Deleters", error: GROUP_BEYOND }] } });
        // The log names the groups that went.
        expect(mocks.audit).toHaveBeenCalledWith(mocks.viewer.id, "DELETE", "GROUP", expect.objectContaining({ bulk: true, succeeded: 1, names: ["Operators"] }));
    });

    it("keeps the group with every permission as it is, also for a platform admin", async () => {
        mocks.viewer = PLATFORM_ADMIN;

        expect(await updateGroup("g-full", { name: "Admin", permissions: [] })).toEqual({ success: false, error: "Admin holds every permission and cannot be edited." });
        expect(mocks.groups.update).not.toHaveBeenCalled();
    });

    it("lets a platform admin give every permission", async () => {
        mocks.viewer = PLATFORM_ADMIN;

        expect((await createGroup({ name: "Deleters", permissions: [PERMISSIONS.STORAGE.DELETE, PERMISSIONS.SETTINGS.WRITE] })).success).toBe(true);
        expect(mocks.groups.create).toHaveBeenCalledWith({ name: "Deleters", permissions: [PERMISSIONS.STORAGE.DELETE, PERMISSIONS.SETTINGS.WRITE] });
    });

    it("keeps the settings of the instance in groups of the home tenant only", async () => {
        mocks.viewer = { ...PLATFORM_ADMIN, tenantId: "t-acme" };
        await createGroup({ name: "Ops", permissions: [PERMISSIONS.JOBS.READ, PERMISSIONS.SETTINGS.READ, PERMISSIONS.SETTINGS.WRITE] });
        await updateGroup("g-ops", { name: "Ops", permissions: [PERMISSIONS.SETTINGS.READ, PERMISSIONS.TENANT_SETTINGS.READ] });

        expect(mocks.groups.create).toHaveBeenCalledWith({ name: "Ops", permissions: [PERMISSIONS.JOBS.READ] });
        expect(mocks.groups.update).toHaveBeenCalledWith("g-ops", { name: "Ops", permissions: [PERMISSIONS.TENANT_SETTINGS.READ] }, { platformAdmin: true });
    });

    it("lets the admin of a customer give what they hold in their tenant, but never the settings of the instance", async () => {
        mocks.viewer = CUSTOMER_ADMIN;

        expect((await createGroup({ name: "Restorers", permissions: [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.TENANT_SETTINGS.WRITE] })).success).toBe(true);
        expect(mocks.groups.create).toHaveBeenCalledWith({ name: "Restorers", permissions: [PERMISSIONS.STORAGE.RESTORE, PERMISSIONS.TENANT_SETTINGS.WRITE] });
        expect((await createGroup({ name: "Sneaky", permissions: [PERMISSIONS.SETTINGS.WRITE] })).success).toBe(true);
        expect(mocks.groups.create).toHaveBeenLastCalledWith({ name: "Sneaky", permissions: [] });
    });
});

describe("groups in All tenants, which changes no tenant", () => {
    beforeEach(() => reset(IN_ALL_TENANTS));

    it("makes, changes and deletes no group without an open tenant", async () => {
        expect(await createGroup({ name: "Ops", permissions: [] })).toEqual({ success: false, error: OPEN_A_TENANT });
        expect(await updateGroup("g-ops", { name: "Ops", permissions: [] })).toEqual({ success: false, error: OPEN_A_TENANT });
        expect(await deleteGroup("g-ops", "g-view")).toEqual({ success: false, error: OPEN_A_TENANT });
        expect(await bulkDeleteGroups(["g-ops"])).toEqual({ success: false, error: OPEN_A_TENANT });
        expect(mocks.groups.create).not.toHaveBeenCalled();
        expect(mocks.groups.update).not.toHaveBeenCalled();
        expect(mocks.groups.delete).not.toHaveBeenCalled();
        expect(mocks.groups.deleteMany).not.toHaveBeenCalled();
    });

    it("moves nobody between groups, a group is given per tenant", async () => {
        expect(await moveUsersToGroup(["lena"], "g-view")).toEqual({ success: false, error: "Open a tenant to move people between groups." });
        expect(mocks.memberships.setRoles).not.toHaveBeenCalled();
    });

    it("still refuses an account of no tenant", async () => {
        mocks.viewer = { ...ADMIN, tenantId: null };

        expect(await deleteGroup("g-ops", "g-view")).toEqual({ success: false, error: OPEN_A_TENANT });
        expect(mocks.groups.delete).not.toHaveBeenCalled();
    });
});
