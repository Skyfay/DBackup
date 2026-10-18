/**
 * Undo and the restore of a deleted account. Its entry waits in its own tenant or in the home
 * tenant, never in the one it was deleted from, so Undo reads it in every tenant, only the viewer's
 * own delete, and checks that the viewer may bring that account back. An account comes back with
 * its email only while no provider of another tenant claims its domain.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
        purgeFromTrash: vi.fn(),
    };
});

const { restoreDeletedAction, undoDeleteAction } = await import("@/app/actions/settings/trash");

/** Carla works in Acme alone. Deleted from the home tenant, her entry waits in Acme. */
const CARLA: Entry = { id: "t-carla", kind: "user", recordId: "u-carla", name: "Carla", permission: "users:write", superAdminOnly: false, deletedById: "nina", deletedAt: new Date(), tenantId: "acme" };
/** An account of several tenants waits in the home tenant for a platform admin. */
const TOM: Entry = { ...CARLA, id: "t-tom", recordId: "u-tom", name: "Tom", superAdminOnly: true, tenantId: "default" };

/** Nina manages the accounts of the platform and works in the home tenant. */
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
        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { anyTenantAccounts: true });
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
        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { anyTenantAccounts: true });
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

        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined });
    });

    it("lets whoever manages the accounts of the platform give any email", async () => {
        mocks.claimedBy = "globex";
        mocks.viewer = { ...mocks.viewer!, permissions: [...mocks.viewer!.permissions, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE] };

        await restoreDeletedAction(["t-carla"]);

        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined });
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
        expect(mocks.restore).toHaveBeenCalledWith(["t-carla"], { newName: undefined });
    });
});
