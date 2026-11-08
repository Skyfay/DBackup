import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import type { PlatformGroupShape } from "@/lib/auth/platform-group-caps";

const P = PERMISSIONS;

/** Support of the MSP: sees the tenants and manages the accounts, runs jobs in Acme and Shop. */
const SUPPORT: PlatformGroupShape = {
    platformPermissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE],
    tenantPermissions: [P.JOBS.READ, P.JOBS.EXECUTE],
    allTenants: false,
    tenantIds: ["acme", "shop"],
};

type Viewer = { id: string; name: string; email: string; isPlatformAdmin: boolean; permissions: string[] };
const ROOT: Viewer = { id: "root", name: "Manu", email: "manu@example.com", isPlatformAdmin: true, permissions: [] };
const NINA: Viewer = { id: "nina", name: "Nina", email: "nina@example.com", isPlatformAdmin: false, permissions: [...SUPPORT.platformPermissions, ...SUPPORT.tenantPermissions] };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as Viewer,
    audit: vi.fn(),
    createPlatformUser: vi.fn(),
    accountRefusalFor: vi.fn(),
    notify: vi.fn(),
    emailRefusal: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
    /** Ids of accounts that do not exist. */
    missing: new Set<string>(),
    /** The domains the sign-in providers claim, as `email-domain-claims.ts` reads them. */
    providers: [] as { domain: string; tenantId: string | null }[],
    service: {
        shapeOf: vi.fn(),
        reachOf: vi.fn(),
        find: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        setFor: vi.fn(),
        holderOf: vi.fn(),
        memberIds: vi.fn(),
    },
}));

// The real check, reduced to the permissions of the viewer, which a platform admin passes.
vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.viewer.isPlatformAdmin && !mocks.viewer.permissions.includes(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The providers that claim a domain and the accounts of no tenant among some, for the real check of a claimed email.
vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findMany: vi.fn(async () => mocks.providers) },
        user: {
            findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
                where.id.in.filter((id) => (TENANTS_OF[id] ?? []).length === 0).map((id) => ({ email: EMAILS[id] ?? `${id}@example.com` }))),
        },
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: mocks.service }));
vi.mock("@/services/user/user-service", () => ({ userService: { createPlatformUser: mocks.createPlatformUser, accountRefusalFor: mocks.accountRefusalFor } }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: mocks.notify }));
// Whom the viewer sees, like `maySeeAccount`: a platform admin and a reach of all tenants every account, else those of a tenant of the reach.
vi.mock("@/services/user/account-visibility", () => ({
    shownAccountName: vi.fn(async (viewer: Viewer & { userId: string }, id: string) => {
        if (mocks.missing.has(id)) return null;
        const reach = viewer.isPlatformAdmin ? "all" : await mocks.service.reachOf(viewer.userId);
        // An account of no tenant counts as one of the home tenant.
        const tenants = TENANTS_OF[id]?.length ? TENANTS_OF[id] : ["default"];
        return reach === "all" || tenants.some((tenantId) => reach.includes(tenantId)) ? id : null;
    }),
}));
vi.mock("@/services/user/new-account-email", () => ({ newAccountEmailRefusal: (...args: unknown[]) => mocks.emailRefusal(...args) }));

const { accountRefusal } = await vi.importActual<typeof import("@/lib/auth/account-access")>("@/lib/auth/account-access");
const { bulkDeletePlatformGroups, createPlatformGroup, createPlatformUser, deletePlatformGroup, setUserPlatformGroup, updatePlatformGroup } = await import("@/app/actions/auth/platform-group");

/** The tenants of the accounts the tests give a platform group to. */
const TENANTS_OF: Record<string, string[]> = {
    lena: ["acme"],
    // Works for Acme and for Globex, which Support does not reach.
    sam: ["acme", "globex"],
    "max-of-globex": ["globex"],
    // Works in no tenant yet, which counts as the home tenant.
    fresh: [],
    // Platform admins who work for Acme, and for Globex alone.
    root: ["acme"],
    "root-of-globex": ["globex"],
    // Of the platform and of no tenant, with an email whose domain the provider of Globex claims.
    "ceo-of-globex": [],
};

const EMAILS: Record<string, string> = { "ceo-of-globex": "ceo@globex.ch" };

const values = (over: Partial<{ platformPermissions: string[]; tenantPermissions: string[]; allTenants: boolean; tenantIds: string[] }> = {}) => ({
    name: "Helpdesk",
    platformPermissions: [P.PLATFORM.TENANTS_READ],
    tenantPermissions: [P.JOBS.READ],
    allTenants: false,
    tenantIds: ["acme"],
    ...over,
});

const HOME_LOG = { tenantId: "default" };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = NINA;
    mocks.service.shapeOf.mockImplementation(async (id: string) => (id === "nina" ? { id: "pg-support", shape: SUPPORT } : null));
    mocks.service.create.mockImplementation(async (input: Record<string, unknown>) => ({ id: "pg-new", ...input }));
    mocks.service.update.mockResolvedValue({ name: "Helpdesk", areas: [] });
    mocks.service.delete.mockResolvedValue({ name: "Helpdesk", members: 0 });
    mocks.service.find.mockImplementation(async (id: string) => ({
        "pg-helpdesk": { id, name: "Helpdesk", shape: { ...SUPPORT, platformPermissions: [P.PLATFORM.TENANTS_READ], tenantIds: ["acme"] } },
        "pg-support": { id, name: "Support", shape: SUPPORT },
        "pg-sharing": { id, name: "Sharing", shape: { ...SUPPORT, platformPermissions: [P.PLATFORM.SHARING_WRITE] } },
    } as Record<string, unknown>)[id] ?? null);
    mocks.service.setFor.mockResolvedValue({ from: "No platform group", to: "Helpdesk" });
    mocks.service.holderOf.mockResolvedValue({ platformAdmin: false, groupId: null });
    mocks.service.memberIds.mockResolvedValue([]);
    mocks.providers = [{ domain: "globex.ch", tenantId: "globex" }, { domain: "acme.ch", tenantId: "acme" }];
    // Support reaches Acme and Shop.
    mocks.service.reachOf.mockImplementation(async (id: string) => (id === "nina" ? SUPPORT.tenantIds : "all"));
    // The service decides with the real rule, from the tenants of the account.
    mocks.accountRefusalFor.mockImplementation(async (caller: Viewer & { reach?: readonly string[] | "all" }, id: string) =>
        accountRefusal({ ...caller, tenantId: null, platformGroupShape: SUPPORT }, { isPlatformAdmin: false, tenantIds: TENANTS_OF[id] ?? [] }));
});

describe("making and changing platform groups", () => {
    it("needs the right to manage the accounts of the platform before it touches anything", async () => {
        mocks.viewer = { ...NINA, permissions: [P.PLATFORM.ACCOUNTS_READ, P.USERS.WRITE, P.GROUPS.WRITE] };

        await expect(createPlatformGroup(values())).rejects.toBeInstanceOf(PermissionError);
        await expect(updatePlatformGroup("pg-helpdesk", values())).rejects.toBeInstanceOf(PermissionError);
        await expect(deletePlatformGroup("pg-helpdesk")).rejects.toBeInstanceOf(PermissionError);
        await expect(setUserPlatformGroup("lena", { kind: "group", id: "pg-helpdesk" })).rejects.toBeInstanceOf(PermissionError);
        for (const call of Object.values(mocks.service)) expect(call).not.toHaveBeenCalled();
    });

    it("makes a group within what the viewer may, and writes it to the log of the home tenant", async () => {
        expect(await createPlatformGroup(values())).toEqual({ success: true, data: { id: "pg-new" } });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "CREATE", "PLATFORM_GROUP", expect.objectContaining({ name: "Helpdesk", scope: "1 tenant" }), "pg-new", HOME_LOG);
    });

    it("refuses a group with a right, a tenant or a scope beyond the viewer's own platform group", async () => {
        expect(await createPlatformGroup(values({ platformPermissions: [P.PLATFORM.TENANTS_WRITE] }))).toEqual(expect.objectContaining({ success: false }));
        expect(await createPlatformGroup(values({ tenantPermissions: [P.STORAGE.DELETE] }))).toEqual(expect.objectContaining({ success: false }));
        expect(await createPlatformGroup(values({ tenantIds: ["praxis"] }))).toEqual(expect.objectContaining({ success: false }));
        expect(await createPlatformGroup(values({ allTenants: true, tenantIds: [] }))).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.service.create).not.toHaveBeenCalled();
    });

    it("lets a platform admin make any group, every tenant included", async () => {
        mocks.viewer = ROOT;
        expect(await createPlatformGroup(values({ platformPermissions: [P.PLATFORM.TENANTS_WRITE, P.SETTINGS.WRITE], allTenants: true, tenantIds: [] }))).toEqual({ success: true, data: { id: "pg-new" } });
    });

    it("never lets someone change or delete their own platform group, nor one that may do more than they may", async () => {
        expect(await updatePlatformGroup("pg-support", values())).toEqual({ success: false, error: "You are in this platform group. Another admin changes it." });
        expect(await deletePlatformGroup("pg-support")).toEqual({ success: false, error: "You are in this platform group. Another admin deletes it." });
        expect(await updatePlatformGroup("pg-sharing", values())).toEqual(expect.objectContaining({ success: false }));
        expect(await deletePlatformGroup("pg-sharing")).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.service.update).not.toHaveBeenCalled();
        expect(mocks.service.delete).not.toHaveBeenCalled();
    });

    it("never lets someone of some tenants change or delete a group whose member works in a tenant beyond them", async () => {
        // Sam of Helpdesk also works for Globex, which Support does not reach.
        mocks.service.memberIds.mockImplementation(async (id: string) => (id === "pg-helpdesk" ? ["lena", "sam"] : []));
        const refusal = (verb: string) => ({ success: false, error: `Someone in this platform group has an account you may not change, so only someone who may change all of them ${verb} it.` });

        expect(await updatePlatformGroup("pg-helpdesk", values())).toEqual(refusal("changes"));
        expect(await deletePlatformGroup("pg-helpdesk")).toEqual(refusal("deletes"));
        expect(await bulkDeletePlatformGroups(["pg-helpdesk"])).toEqual({ success: true, data: { succeeded: [], failed: [{ id: "pg-helpdesk", name: "Helpdesk", error: refusal("deletes").error }] } });
        expect(mocks.service.update).not.toHaveBeenCalled();
        expect(mocks.service.delete).not.toHaveBeenCalled();

        // A reach of all tenants and a platform admin go on.
        mocks.service.reachOf.mockResolvedValue("all");
        expect(await updatePlatformGroup("pg-helpdesk", values())).toEqual({ success: true });
        mocks.viewer = ROOT;
        expect(await deletePlatformGroup("pg-helpdesk")).toEqual(expect.objectContaining({ success: true }));
    });

    it("changes a group within reach and keeps what changed in the log of the home tenant", async () => {
        expect(await updatePlatformGroup("pg-helpdesk", values())).toEqual({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "PLATFORM_GROUP", { name: "Helpdesk", areas: [] }, "pg-helpdesk", HOME_LOG);
    });
});

describe("giving someone a platform group", () => {
    it("gives a group within reach and writes the change of the account to the log of the home tenant", async () => {
        expect(await setUserPlatformGroup("lena", { kind: "group", id: "pg-helpdesk" })).toEqual({ success: true, data: { from: "No platform group", to: "Helpdesk" } });
        expect(mocks.service.setFor).toHaveBeenCalledWith("lena", { kind: "group", id: "pg-helpdesk" });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "USER", { change: "Platform group set", name: "lena", from: "No platform group", to: "Helpdesk" }, "lena", HOME_LOG);
    });

    it("leaves the platform admin role to a platform admin, to give and to take", async () => {
        expect(await setUserPlatformGroup("lena", { kind: "admin" })).toEqual({ success: false, error: "Only a platform admin gives or takes the platform admin role." });
        mocks.service.holderOf.mockResolvedValue({ platformAdmin: true, groupId: null });
        expect(await setUserPlatformGroup("root", { kind: "none" })).toEqual({ success: false, error: "Only a platform admin gives or takes the platform admin role." });
        expect(mocks.service.setFor).not.toHaveBeenCalled();

        mocks.viewer = ROOT;
        mocks.service.holderOf.mockResolvedValue({ platformAdmin: false, groupId: null });
        expect(await setUserPlatformGroup("lena", { kind: "admin" })).toEqual(expect.objectContaining({ success: true }));
    });

    it("never gives a group beyond the viewer, nor takes one from someone it lets do more", async () => {
        expect(await setUserPlatformGroup("lena", { kind: "group", id: "pg-sharing" })).toEqual({ success: false, error: "This platform group may do more than you may, so you cannot give it to anyone." });
        mocks.service.holderOf.mockResolvedValue({ platformAdmin: false, groupId: "pg-sharing" });
        expect(await setUserPlatformGroup("lena", { kind: "none" })).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.service.setFor).not.toHaveBeenCalled();
    });

    it("never changes the own platform group, a platform admin's included", async () => {
        mocks.viewer = ROOT;
        expect(await setUserPlatformGroup("root", { kind: "none" })).toEqual({ success: false, error: "Another admin changes your own platform group." });
        expect(mocks.service.setFor).not.toHaveBeenCalled();
    });

    it("lets someone of a platform group of some tenants give a platform group only to an account of those tenants", async () => {
        const beyond = { success: false, error: "This account works in a tenant your platform group does not reach. Only someone who reaches all of its tenants can change it." };

        const gone = { success: false, error: "The account no longer exists." };

        // Max works for Globex alone and a fresh account counts as one of the home tenant, so she sees
        // neither and hears what a missing account answers. Sam also works for Acme, which she sees.
        expect(await setUserPlatformGroup("max-of-globex", { kind: "group", id: "pg-helpdesk" })).toEqual(gone);
        expect(await setUserPlatformGroup("fresh", { kind: "group", id: "pg-helpdesk" })).toEqual(gone);
        expect(await setUserPlatformGroup("sam", { kind: "group", id: "pg-helpdesk" })).toEqual(beyond);
        expect(await setUserPlatformGroup("sam", { kind: "none" })).toEqual(beyond);
        expect(mocks.service.setFor).not.toHaveBeenCalled();
        expect(mocks.accountRefusalFor).toHaveBeenCalledWith(expect.objectContaining({ id: "nina", reach: ["acme", "shop"] }), "sam");

        expect(await setUserPlatformGroup("lena", { kind: "group", id: "pg-helpdesk" })).toEqual(expect.objectContaining({ success: true }));
    });

    it("answers an account she may not see, a platform admin's too, exactly like one that does not exist", async () => {
        const gone = { success: false, error: "The account no longer exists." };
        // A platform admin of Globex alone, beyond her platform group, and an id of no account.
        mocks.service.holderOf.mockImplementation(async (id: string) => (id === "nobody" ? null : { platformAdmin: id.startsWith("root"), groupId: null }));
        expect(await setUserPlatformGroup("root-of-globex", { kind: "none" })).toEqual(gone);
        expect(await setUserPlatformGroup("nobody", { kind: "none" })).toEqual(gone);
        // A platform admin she sees still hears why.
        expect(await setUserPlatformGroup("root", { kind: "none" })).toEqual({ success: false, error: "Only a platform admin gives or takes the platform admin role." });
        expect(mocks.service.setFor).not.toHaveBeenCalled();
    });

    it("leaves a platform admin and a platform group of all tenants as they were", async () => {
        mocks.viewer = ROOT;
        expect(await setUserPlatformGroup("max-of-globex", { kind: "group", id: "pg-helpdesk" })).toEqual(expect.objectContaining({ success: true }));

        mocks.viewer = NINA;
        mocks.service.reachOf.mockResolvedValue("all");
        mocks.service.shapeOf.mockResolvedValue({ id: "pg-support", shape: { ...SUPPORT, allTenants: true, tenantIds: [] } });
        expect(await setUserPlatformGroup("max-of-globex", { kind: "group", id: "pg-helpdesk" })).toEqual(expect.objectContaining({ success: true }));
        expect(await setUserPlatformGroup("fresh", { kind: "group", id: "pg-helpdesk" })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.accountRefusalFor).not.toHaveBeenCalled();
    });
});

describe("deleting several platform groups at once", () => {
    it("needs the right to manage the accounts of the platform", async () => {
        mocks.viewer = { ...NINA, permissions: [P.PLATFORM.ACCOUNTS_READ] };
        await expect(bulkDeletePlatformGroups(["pg-helpdesk"])).rejects.toThrow(PermissionError);
        expect(mocks.service.delete).not.toHaveBeenCalled();
    });

    it("deletes what the viewer may change and keeps, with why, their own and one beyond them", async () => {
        const result = await bulkDeletePlatformGroups(["pg-helpdesk", "pg-support", "pg-sharing", "platform-admin"]);

        expect(result).toEqual({
            success: true,
            data: {
                succeeded: ["pg-helpdesk"],
                failed: [
                    { id: "pg-support", name: "Support", error: "You are in this platform group. Another admin deletes it." },
                    { id: "pg-sharing", name: "Sharing", error: expect.stringMatching(/may do more than you may/) },
                    { id: "platform-admin", name: undefined, error: "The platform group no longer exists." },
                ],
            },
        });
        expect(mocks.service.delete).toHaveBeenCalledTimes(1);
        expect(mocks.audit).toHaveBeenCalledWith("nina", "DELETE", "PLATFORM_GROUP", expect.objectContaining({ name: "Helpdesk" }), "pg-helpdesk", HOME_LOG);
    });
});

describe("a new account of the platform", () => {
    const account = (platformGroup: { kind: "admin" } | { kind: "group"; id: string }) => ({ name: "Lena Graf", email: "lena@example.com", password: "Correct-Horse-9", platformGroup });

    beforeEach(() => {
        mocks.createPlatformUser.mockResolvedValue({ id: "u-lena" });
        mocks.notify.mockResolvedValue(undefined);
        // An account of no tenant is for whoever looks after every tenant, so Support reaches all of them here.
        mocks.service.reachOf.mockResolvedValue("all");
        mocks.service.shapeOf.mockResolvedValue({ id: "pg-support", shape: { ...SUPPORT, allTenants: true, tenantIds: [] } });
    });

    it("is for a platform admin or a platform group that reaches the home tenant, never one of other tenants alone", async () => {
        mocks.service.reachOf.mockResolvedValue(SUPPORT.tenantIds);
        mocks.service.shapeOf.mockResolvedValue({ id: "pg-support", shape: SUPPORT });

        expect(await createPlatformUser(account({ kind: "group", id: "pg-helpdesk" }))).toEqual({ success: false, error: expect.stringMatching(/does not reach it/) });
        expect(mocks.createPlatformUser).not.toHaveBeenCalled();
    });

    it("is made in one step by a platform group that reaches the home tenant, like New user without a group and then its platform group", async () => {
        // An account of no tenant counts as one of the home tenant, which her platform group reaches.
        mocks.service.reachOf.mockResolvedValue(["default", ...SUPPORT.tenantIds]);
        mocks.service.shapeOf.mockResolvedValue({ id: "pg-support", shape: { ...SUPPORT, tenantIds: ["default", ...SUPPORT.tenantIds] } });

        expect(await createPlatformUser(account({ kind: "group", id: "pg-helpdesk" }))).toEqual({ success: true, data: { id: "u-lena" } });
        expect(mocks.createPlatformUser).toHaveBeenCalledWith(expect.objectContaining({ email: "lena@example.com" }), { kind: "group", id: "pg-helpdesk" });
    });

    it("needs the right to manage the accounts of the platform", async () => {
        mocks.viewer = { ...NINA, permissions: [P.PLATFORM.ACCOUNTS_READ] };
        await expect(createPlatformUser(account({ kind: "group", id: "pg-helpdesk" }))).rejects.toThrow(PermissionError);
        expect(mocks.createPlatformUser).not.toHaveBeenCalled();
    });

    it("makes a platform admin only for a platform admin", async () => {
        expect(await createPlatformUser(account({ kind: "admin" }))).toEqual({ success: false, error: "Only a platform admin gives or takes the platform admin role." });
        mocks.viewer = ROOT;
        expect(await createPlatformUser(account({ kind: "admin" }))).toEqual({ success: true, data: { id: "u-lena" } });
        expect(mocks.createPlatformUser).toHaveBeenCalledWith({ name: "Lena Graf", email: "lena@example.com", password: "Correct-Horse-9" }, { kind: "admin" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "USER", expect.objectContaining({ name: "Lena Graf", platformGroup: "Platform admin" }), "u-lena", HOME_LOG);
    });

    it("gives no platform group that may do more than the viewer, and one that is gone to nobody", async () => {
        expect(await createPlatformUser(account({ kind: "group", id: "pg-sharing" }))).toEqual({ success: false, error: expect.stringMatching(/may do more than you may/) });
        expect(await createPlatformUser(account({ kind: "group", id: "pg-gone" }))).toEqual({ success: false, error: "The platform group no longer exists." });
        expect(mocks.createPlatformUser).not.toHaveBeenCalled();
    });

    it("creates the account with a platform group the viewer may give", async () => {
        expect(await createPlatformUser(account({ kind: "group", id: "pg-helpdesk" }))).toEqual({ success: true, data: { id: "u-lena" } });
        expect(mocks.createPlatformUser).toHaveBeenCalledWith(expect.objectContaining({ email: "lena@example.com" }), { kind: "group", id: "pg-helpdesk" });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "CREATE", "USER", expect.objectContaining({ platformGroup: "Helpdesk" }), "u-lena", HOME_LOG);
    });

    it("says why the account could not be made with a fixed sentence, never the words of the sign-up", async () => {
        mocks.createPlatformUser.mockRejectedValueOnce(new Error("User already exists. Use another email."));
        expect(await createPlatformUser(account({ kind: "group", id: "pg-helpdesk" }))).toEqual({ success: false, error: "The account could not be created." });
        // A rule of Settings > Passwords names itself.
        mocks.createPlatformUser.mockRejectedValueOnce(new ValidationError("The password needs at least 12 characters."));
        expect(await createPlatformUser(account({ kind: "group", id: "pg-helpdesk" }))).toEqual({ success: false, error: "The password needs at least 12 characters." });
    });

    it("answers an email of an existing account with the sentence of New user, and makes no account", async () => {
        mocks.emailRefusal.mockResolvedValueOnce("An account with this email exists already. Add it to the tenant with an invitation instead.");
        expect(await createPlatformUser(account({ kind: "group", id: "pg-helpdesk" }))).toEqual({ success: false, error: "An account with this email exists already. Add it to the tenant with an invitation instead." });
        expect(mocks.emailRefusal).toHaveBeenCalledWith("lena@example.com", expect.objectContaining({ userId: "nina" }), "default");
        expect(mocks.createPlatformUser).not.toHaveBeenCalled();
    });
});

describe("an email that the sign-in provider of a tenant claims", () => {
    const CLAIMED = "The domain of this email signs in through the provider of another tenant. Only someone who manages the accounts of the platform can use it here.";
    // Support reaches the home tenant, Acme and Shop, never Globex.
    const HOME_SUPPORT: PlatformGroupShape = { ...SUPPORT, tenantIds: ["default", ...SUPPORT.tenantIds] };

    beforeEach(() => {
        mocks.createPlatformUser.mockResolvedValue({ id: "u-new" });
        mocks.notify.mockResolvedValue(undefined);
        mocks.service.reachOf.mockResolvedValue(HOME_SUPPORT.tenantIds);
        mocks.service.shapeOf.mockResolvedValue({ id: "pg-support", shape: HOME_SUPPORT });
        mocks.accountRefusalFor.mockImplementation(async (caller: Viewer & { reach?: readonly string[] | "all" }, id: string) =>
            accountRefusal({ ...caller, tenantId: null, platformGroupShape: HOME_SUPPORT }, { isPlatformAdmin: false, tenantIds: TENANTS_OF[id] ?? [] }));
    });

    const account = (email: string) => ({ name: "Ceo", email, password: "Correct-Horse-9", platformGroup: { kind: "group" as const, id: "pg-helpdesk" } });

    it("goes to a new account of the platform only from someone who reaches the tenant of the provider", async () => {
        expect(await createPlatformUser(account("ceo@globex.ch"))).toEqual({ success: false, error: CLAIMED });
        expect(mocks.createPlatformUser).not.toHaveBeenCalled();

        // The domain of a tenant her platform group reaches, and a domain nobody claims.
        expect(await createPlatformUser(account("ceo@acme.ch"))).toEqual({ success: true, data: { id: "u-new" } });
        expect(await createPlatformUser(account("ceo@example.com"))).toEqual({ success: true, data: { id: "u-new" } });

        // A platform group of all tenants and a platform admin give any email.
        mocks.service.reachOf.mockResolvedValue("all");
        expect(await createPlatformUser(account("ceo@globex.ch"))).toEqual({ success: true, data: { id: "u-new" } });
        mocks.viewer = ROOT;
        expect(await createPlatformUser(account("ceo@globex.ch"))).toEqual({ success: true, data: { id: "u-new" } });
    });

    it("keeps the platform group of an account of no tenant with such an email, which would join that tenant without it", async () => {
        mocks.service.holderOf.mockResolvedValue({ platformAdmin: false, groupId: "pg-helpdesk" });

        expect(await setUserPlatformGroup("ceo-of-globex", { kind: "none" })).toEqual({ success: false, error: expect.stringMatching(/claims its email/) });
        expect(mocks.service.setFor).not.toHaveBeenCalled();

        // Another platform group keeps it out of Globex, and an account of a tenant never joins another one by its email.
        expect(await setUserPlatformGroup("ceo-of-globex", { kind: "group", id: "pg-helpdesk" })).toEqual(expect.objectContaining({ success: true }));
        expect(await setUserPlatformGroup("lena", { kind: "none" })).toEqual(expect.objectContaining({ success: true }));

        mocks.viewer = ROOT;
        expect(await setUserPlatformGroup("ceo-of-globex", { kind: "none" })).toEqual(expect.objectContaining({ success: true }));
    });

    it("keeps a platform group whose member of no tenant has such an email", async () => {
        mocks.service.memberIds.mockImplementation(async (id: string) => (id === "pg-helpdesk" ? ["lena", "ceo-of-globex"] : []));
        const refused = expect.stringMatching(/claims their email/);

        expect(await deletePlatformGroup("pg-helpdesk")).toEqual({ success: false, error: refused });
        expect(await bulkDeletePlatformGroups(["pg-helpdesk"])).toEqual({ success: true, data: { succeeded: [], failed: [{ id: "pg-helpdesk", name: "Helpdesk", error: refused }] } });
        expect(mocks.service.delete).not.toHaveBeenCalled();

        mocks.viewer = ROOT;
        expect(await deletePlatformGroup("pg-helpdesk")).toEqual(expect.objectContaining({ success: true }));
    });
});
