/**
 * Undo and the restore of a deleted account. Its entry waits in its own tenant or in the home
 * tenant, never in the one it was deleted from, so Undo reads it in every tenant, only the viewer's
 * own delete, and checks that the viewer may bring that account back. An account comes back with
 * its email only while no provider of another tenant claims its domain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Entry = { id: string; kind: string; recordId: string; name: string; permission: string; superAdminOnly: boolean; deletedById: string | null; deletedAt: Date; tenantId: string };
type Viewer = { id: string; isPlatformAdmin: boolean; tenantId: string | null; allTenants?: boolean; permissions: string[] };

const mocks = vi.hoisted(() => ({
    viewer: null as Viewer | null,
    /** The tenants the platform group of the viewer reaches, every one by default. */
    reach: "all" as "all" | string[],
    entries: [] as Entry[],
    accounts: [] as { id: string; email: string; tenantIds: string[] }[],
    claimedBy: null as string | null,
    restore: vi.fn(),
    latest: vi.fn(),
    audit: vi.fn(),
    /** The check of an email that has an account, see tests/unit/services/new-account-email.test.ts. */
    taken: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
    purge: vi.fn(),
    /** The groups of the snapshot of each entry, see tests/unit/services/trash-account-groups.test.ts. */
    groups: new Map<string, { tenantId: string; group: { permissions: string; fullAccess: boolean } }[]>(),
}));

vi.mock("@/lib/auth/access-control", async () => {
    const { AuthenticationError, PermissionError } = await vi.importActual<typeof import("@/lib/logging/errors")>("@/lib/logging/errors");
    return {
        checkPermission: vi.fn(async (permission: string) => {
            if (!mocks.viewer) throw new AuthenticationError();
            if (!mocks.viewer.isPlatformAdmin && !mocks.viewer.permissions.includes(permission)) throw new PermissionError(permission);
            return mocks.viewer;
        }),
        getViewer: vi.fn(async () => mocks.viewer),
        getUserPermissions: vi.fn(async () => mocks.viewer?.permissions ?? []),
        tenantRefusal: (ctx: { tenantId: string | null; allTenants?: boolean }) => (ctx.tenantId ? null : ctx.allTenants ? "All tenants only reads." : "You work in no tenant yet."),
    };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
// Like the service: every tenant for a platform admin, the reach of the platform group with the right to manage the accounts.
vi.mock("@/services/user/user-service", () => ({
    userService: {
        accountsReachOf: vi.fn(async (caller: { isPlatformAdmin: boolean; permissions: readonly string[] }) =>
            caller.isPlatformAdmin ? "all" : caller.permissions.includes("platform-accounts:write") ? mocks.reach : []),
    },
}));
vi.mock("@/services/sso/email-domain-claims", () => ({
    claimedEmailRefusal: vi.fn(async (_email: string, tenantIds: readonly string[], platformLevel: boolean) =>
        !platformLevel && mocks.claimedBy && !tenantIds.includes(mocks.claimedBy) ? "The domain of this email signs in through the provider of another tenant." : null),
}));
vi.mock("@/services/user/new-account-email", () => ({
    CHANGED_EMAIL_ANSWERS: { known: "known", refused: "refused", spent: "spent" },
    takenEmailRefusal: (...args: unknown[]) => mocks.taken(...args),
}));
vi.mock("@/services/trash/trash-service", async () => {
    const actual = await vi.importActual<typeof import("@/services/trash/trash-service")>("@/services/trash/trash-service");
    return {
        mayHandle: actual.mayHandle,
        mayRestoreAccount: actual.mayRestoreAccount,
        trashEntries: vi.fn(async (ids: string[]) => mocks.entries.filter((entry) => ids.includes(entry.id))),
        latestTrashIds: vi.fn(async () => []),
        latestAccountEntries: mocks.latest,
        trashAccounts: vi.fn(async (ids: string[]) => mocks.accounts.filter((account) => ids.includes(account.id))),
        restoreFromTrash: mocks.restore,
        purgeFromTrash: mocks.purge,
    };
});
// The groups of each snapshot, weighed against what the caller may in the tenant they work in.
vi.mock("@/services/trash/account-groups", async () => {
    const { GROUP_BEYOND_ACCOUNT_REFUSAL, heldGroupBeyond } = await vi.importActual<typeof import("@/lib/auth/account-access")>("@/lib/auth/account-access");
    return {
        trashAccountCaps: vi.fn(async (_caller: unknown, ids: string[]) => ({ groups: new Map(ids.map((id) => [id, mocks.groups.get(id) ?? []])), permissionsByTenant: {} })),
        groupBeyondRefusals: vi.fn(async (caller: { isPlatformAdmin: boolean; tenantId: string | null; permissions: string[] }, entries: { id: string; kind: string; name: string }[]) =>
            entries.filter((entry) => entry.kind === "user" && heldGroupBeyond(caller, mocks.groups.get(entry.id) ?? [])).map((entry) => ({ id: entry.id, name: entry.name, error: GROUP_BEYOND_ACCOUNT_REFUSAL }))),
    };
});

const { purgeDeletedAction, restoreDeletedAction, undoDeleteAction } = await import("@/app/actions/settings/trash");

/** Carla works in Acme alone. Deleted from the home tenant, her entry waits in Acme. */
const CARLA: Entry = { id: "t-carla", kind: "user", recordId: "u-carla", name: "Carla", permission: "users:write", superAdminOnly: false, deletedById: "nina", deletedAt: new Date(), tenantId: "acme" };
/** An account of several tenants waits in the home tenant for a platform admin. */
const TOM: Entry = { ...CARLA, id: "t-tom", recordId: "u-tom", name: "Tom", superAdminOnly: true, tenantId: "default" };

/** Nina manages the accounts of the platform and works in the home tenant. */
/** The caller the guards of a restored connection get, an action always has a session. */
const SESSION = expect.objectContaining({ authMethod: "session" });

const NINA: Viewer = { id: "nina", isPlatformAdmin: false, tenantId: "default", permissions: [PERMISSIONS.USERS.WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE, "tenant-settings:write"] };

const restoredAll = async (ids: string[]) => ({ restored: ids.map((id) => ({ id, recordId: `r-${id}`, kind: "user", name: "back", notes: [] })), conflicts: [], failed: [] });

describe("Undo of a deleted account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = NINA;
        mocks.reach = "all";
        mocks.claimedBy = null;
        mocks.accounts = [{ id: "t-carla", email: "carla@acme.example", tenantIds: ["acme"] }];
        mocks.restore.mockImplementation(restoredAll);
    });

    it("brings back the viewer's own delete from whichever tenant its entry waits in", async () => {
        mocks.latest.mockResolvedValue([CARLA]);

        const result = await undoDeleteAction("user", ["u-carla"]);

        expect(result).toMatchObject({ success: true });
        expect(mocks.latest).toHaveBeenCalledWith(["u-carla"]);
        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { anyTenantAccounts: true, caller: SESSION });
    });

    it("is no way to someone else's delete", async () => {
        mocks.latest.mockResolvedValue([{ ...CARLA, deletedById: "tom" }]);

        expect(await undoDeleteAction("user", ["u-carla"])).toMatchObject({ success: false });
        expect(mocks.restore).not.toHaveBeenCalled();
    });

    it("leaves an account only a platform admin brings back to a platform admin", async () => {
        mocks.latest.mockResolvedValue([TOM]);

        expect(await undoDeleteAction("user", ["u-tom"])).toMatchObject({ success: false });
        mocks.viewer = { ...NINA, id: "root", isPlatformAdmin: true };
        mocks.latest.mockResolvedValue([{ ...TOM, deletedById: "root" }]);
        expect(await undoDeleteAction("user", ["u-tom"])).toMatchObject({ success: true });
        expect(mocks.restore).toHaveBeenCalledTimes(1);
    });

    it("lets the admin of another tenant bring back no account of Acme, the admin of Acme does", async () => {
        mocks.latest.mockResolvedValue([CARLA]);
        mocks.viewer = { id: "nina", isPlatformAdmin: false, tenantId: "globex", permissions: [PERMISSIONS.USERS.WRITE] };
        expect(await undoDeleteAction("user", ["u-carla"])).toMatchObject({ success: false });

        mocks.viewer = { id: "nina", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE] };
        expect(await undoDeleteAction("user", ["u-carla"])).toMatchObject({ success: true });
        expect(mocks.restore).toHaveBeenCalledTimes(1);
    });

    it("lets a platform group of some tenants bring back an account of its tenants and none beyond them", async () => {
        mocks.latest.mockResolvedValue([CARLA]);
        // Nina's platform group reaches Globex, Carla worked in Acme.
        mocks.reach = ["globex"];
        expect(await undoDeleteAction("user", ["u-carla"])).toMatchObject({ success: false });
        expect(mocks.restore).not.toHaveBeenCalled();

        mocks.reach = ["acme", "globex"];
        expect(await undoDeleteAction("user", ["u-carla"])).toMatchObject({ success: true });
        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { anyTenantAccounts: true, caller: SESSION });
    });

    it("writes the Undo into the log of the tenant the account waited in, else into the log of the platform", async () => {
        // A platform admin works in Globex, Carla of Acme waited in Acme. Globex must not read about her.
        mocks.viewer = { id: "root", isPlatformAdmin: true, tenantId: "globex", permissions: [] };
        mocks.latest.mockResolvedValue([{ ...CARLA, deletedById: "root" }]);
        await undoDeleteAction("user", ["u-carla"]);
        expect(mocks.audit).toHaveBeenLastCalledWith("root", "RESTORE", "USER", expect.objectContaining({ action: "trash_restore" }), "r-t-carla", { tenantId: "default" });

        // The admin of Acme brings her back in Acme, which keeps the entry.
        mocks.viewer = { id: "nina", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE] };
        mocks.latest.mockResolvedValue([CARLA]);
        await undoDeleteAction("user", ["u-carla"]);
        expect(mocks.audit).toHaveBeenLastCalledWith("nina", "RESTORE", "USER", expect.objectContaining({ action: "trash_restore" }), "r-t-carla", { tenantId: "acme" });

        // Tom waited in the home tenant for a platform admin, who undoes it from Acme.
        mocks.viewer = { id: "root", isPlatformAdmin: true, tenantId: "acme", permissions: [] };
        mocks.accounts = [];
        mocks.latest.mockResolvedValue([{ ...TOM, deletedById: "root" }]);
        await undoDeleteAction("user", ["u-tom"]);
        expect(mocks.audit).toHaveBeenLastCalledWith("root", "RESTORE", "USER", expect.objectContaining({ action: "trash_restore" }), "r-t-tom", { tenantId: "default" });
    });

    it("leaves an account out whose domain the provider of another tenant claims by now", async () => {
        mocks.viewer = { id: "nina", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE] };
        mocks.latest.mockResolvedValue([CARLA]);
        mocks.claimedBy = "globex";

        const result = await undoDeleteAction("user", ["u-carla"]);

        expect(mocks.restore).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, data: { restored: [], failed: [{ id: "t-carla", name: "Carla" }] } });
    });
});

describe("restoring a deleted account under its own email", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reach = "all";
        mocks.viewer = { id: "lena", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE, "tenant-settings:write"] };
        mocks.entries = [CARLA];
        mocks.accounts = [{ id: "t-carla", email: "carla@globex.example", tenantIds: ["acme"] }];
        mocks.restore.mockImplementation(restoredAll);
    });

    it("checks the domain of the email it comes back with, like a new one", async () => {
        mocks.claimedBy = "globex";

        const result = await restoreDeletedAction(["t-carla"]);

        expect(mocks.restore).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, data: { failed: [{ id: "t-carla", error: expect.stringContaining("provider of another tenant") }] } });
    });

    it("restores it while the domain is free or claimed by its own tenant", async () => {
        mocks.claimedBy = "acme";

        await restoreDeletedAction(["t-carla"]);

        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined, caller: SESSION });
    });

    it("lets whoever manages the accounts of the platform give any email", async () => {
        mocks.claimedBy = "globex";
        mocks.viewer = { ...mocks.viewer!, permissions: [...mocks.viewer!.permissions, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE] };

        await restoreDeletedAction(["t-carla"]);

        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined, caller: SESSION });
    });

    it("lets a platform group of some tenants give the emails its tenants claim, never one of a tenant beyond them", async () => {
        mocks.claimedBy = "globex";
        mocks.viewer = { ...mocks.viewer!, permissions: [...mocks.viewer!.permissions, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE] };

        mocks.reach = ["acme"];
        const refused = await restoreDeletedAction(["t-carla"]);
        expect(mocks.restore).not.toHaveBeenCalled();
        expect(refused).toMatchObject({ success: true, data: { failed: [{ id: "t-carla", error: expect.stringContaining("provider of another tenant") }] } });

        mocks.reach = ["acme", "globex"];
        await restoreDeletedAction(["t-carla"]);
        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined, caller: SESSION });
    });

    it("answers an own email someone holds by now like a new one, which counts a try, and asks for another email", async () => {
        mocks.claimedBy = null;
        mocks.taken.mockResolvedValueOnce("This email cannot be given to this account. Pick another email.");

        const result = await restoreDeletedAction(["t-carla"]);

        expect(mocks.taken).toHaveBeenCalledWith("carla@globex.example", expect.objectContaining({ userId: "lena" }), "acme", expect.anything());
        expect(mocks.restore).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true, data: { restored: [], conflicts: [{ id: "t-carla", kind: "user", name: "Carla", message: "This email cannot be given to this account. Pick another email." }], failed: [] } });
    });

    it("checks the own email on Undo too", async () => {
        mocks.claimedBy = null;
        mocks.viewer = { id: "nina", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE] };
        mocks.latest.mockResolvedValue([CARLA]);
        mocks.taken.mockResolvedValueOnce("This email cannot be given to this account. Pick another email.");

        const result = await undoDeleteAction("user", ["u-carla"]);

        expect(mocks.restore).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, data: { conflicts: [{ id: "t-carla", message: "This email cannot be given to this account. Pick another email." }] } });
    });
});

describe("restoring a deleted account under another email", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reach = "all";
        mocks.claimedBy = null;
        mocks.viewer = { id: "lena", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE, "tenant-settings:write"] };
        mocks.entries = [CARLA];
        mocks.accounts = [{ id: "t-carla", email: "carla@acme.example", tenantIds: ["acme"] }];
        mocks.restore.mockImplementation(restoredAll);
    });

    it("answers an email of an account the admin may not see with the fixed sentence, and restores nothing", async () => {
        mocks.taken.mockResolvedValueOnce("This email cannot be given to this account. Pick another email.");

        expect(await restoreDeletedAction(["t-carla"], "gina@globex.example")).toEqual({ success: false, error: "This email cannot be given to this account. Pick another email." });
        expect(mocks.taken).toHaveBeenCalledWith("gina@globex.example", expect.objectContaining({ userId: "lena" }), "acme", expect.anything());
        expect(mocks.restore).not.toHaveBeenCalled();
    });

    it("never gives a new email to the one account left after another of the pick was refused", async () => {
        const dora: Entry = { ...CARLA, id: "t-dora", recordId: "u-dora", name: "Dora" };
        mocks.entries = [CARLA, dora];
        mocks.accounts = [...mocks.accounts, { id: "t-dora", email: "dora@acme.example", tenantIds: ["acme"] }];
        // Dora's own email is held by someone by now, so she drops out and Carla is left alone.
        mocks.taken.mockImplementation(async (email: unknown) => email === "dora@acme.example" ? "This email cannot be given to this account. Pick another email." : null);

        await restoreDeletedAction(["t-carla", "t-dora"], "boss@globex.example");

        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined, caller: SESSION });
        mocks.taken.mockReset();
    });

    it("restores it under a free email", async () => {
        await restoreDeletedAction(["t-carla"], "carla.new@acme.example");

        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: "carla.new@acme.example", caller: SESSION });
    });
});

describe("a deleted account whose group may do more than the viewer", () => {
    const REFUSED = "This user's group may do more than you may, so only someone who may do all of it can change their account.";
    /** The Admin of Acme, a group with every permission. */
    const ADMIN_OF_ACME = [{ tenantId: "acme", group: { permissions: "[]", fullAccess: true } }];
    const BOSS: Entry = { ...CARLA, id: "t-boss", recordId: "u-boss", name: "Boss" };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reach = "all";
        mocks.claimedBy = null;
        // Lena manages the users of Acme and may change its settings, nothing more.
        mocks.viewer = { id: "lena", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE, "tenant-settings:write"] };
        mocks.entries = [CARLA, BOSS];
        mocks.accounts = [{ id: "t-carla", email: "carla@acme.example", tenantIds: ["acme"] }, { id: "t-boss", email: "boss@acme.example", tenantIds: ["acme"] }];
        mocks.groups = new Map([["t-boss", ADMIN_OF_ACME]]);
        mocks.restore.mockImplementation(restoredAll);
        mocks.purge.mockImplementation(async (ids: string[]) => ids.length);
    });

    afterEach(() => {
        mocks.groups = new Map();
    });

    it("stays in Recently deleted when the admin of the tenant restores it under its own email", async () => {
        const result = await restoreDeletedAction(["t-boss"]);

        expect(mocks.restore).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, data: { restored: [], failed: [{ id: "t-boss", error: REFUSED }] } });
    });

    it("is refused under a new email before the email is looked at", async () => {
        const result = await restoreDeletedAction(["t-boss"], "lena.owns.this@acme.example");

        expect(result).toEqual({ success: false, error: REFUSED });
        expect(mocks.taken).not.toHaveBeenCalled();
        expect(mocks.restore).not.toHaveBeenCalled();
    });

    it("leaves only that row out of a batch", async () => {
        const result = await restoreDeletedAction(["t-carla", "t-boss"]);

        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined, caller: SESSION });
        expect(result).toMatchObject({ success: true, data: { failed: [{ id: "t-boss", error: REFUSED }] } });
    });

    it("comes back through a platform admin", async () => {
        mocks.viewer = { ...mocks.viewer!, isPlatformAdmin: true };

        await restoreDeletedAction(["t-boss"]);

        expect(mocks.restore).toHaveBeenCalledWith(["t-boss"], { newName: undefined, caller: SESSION });
    });

    it("is not deleted for good by the admin of the tenant, alone or in a batch", async () => {
        expect(await purgeDeletedAction(["t-boss"])).toEqual({ success: false, error: REFUSED });
        expect(mocks.purge).not.toHaveBeenCalled();

        const batch = await purgeDeletedAction(["t-carla", "t-boss"]);
        expect(mocks.purge).toHaveBeenCalledWith(["t-carla"]);
        expect(batch).toMatchObject({ success: true, data: { purged: ["t-carla"], failed: [{ id: "t-boss", error: REFUSED }] } });
    });

    it("is no Undo for someone whose own rights fall short of its group", async () => {
        mocks.latest.mockResolvedValue([{ ...BOSS, deletedById: "lena" }]);

        expect(await undoDeleteAction("user", ["u-boss"])).toMatchObject({ success: false });
        expect(mocks.restore).not.toHaveBeenCalled();
    });
});
