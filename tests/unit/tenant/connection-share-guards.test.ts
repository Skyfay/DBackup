/**
 * The guards of the actions around shared destinations and channels: what is shared is seen with
 * See what is shared, changed with Share with customers, both rights of the platform, and the
 * recipients of a shared channel are the customer's own with the right to change its channels.
 * Each refused one touches no service, and none works in All tenants.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";

const mocks = vi.hoisted(() => ({
    granted: new Set<string>(),
    viewer: { id: "u-lena", name: "Lena Graf", tenantId: "acme" as string | null, allTenants: false },
    service: {
        view: vi.fn(),
        losing: vi.fn(),
        save: vi.fn(),
        stopFor: vi.fn(),
        deleteBackupsOf: vi.fn(),
    },
    setRecipients: vi.fn(),
    sendTest: vi.fn(),
    audit: vi.fn(),
    reachOf: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.granted.has(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
    // The refusal of the real module, which names All tenants and an account of no tenant apart.
    tenantRefusal: (ctx: { tenantId: string | null; allTenants?: boolean }) =>
        ctx.tenantId ? null : ctx.allTenants ? "All tenants only reads. Open the tenant of the record to change it." : "You work in no tenant yet.",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/sharing/connection-shares", async () => {
    const { ValidationError } = await import("@/lib/logging/errors");
    class ShareChangeError extends ValidationError {
        constructor(message: string, readonly change: unknown) {
            super(message);
        }
    }
    return { connectionShareService: mocks.service, ShareChangeError };
});
vi.mock("@/services/sharing/channel-recipients", () => ({ setRecipients: mocks.setRecipients }));
vi.mock("@/services/sharing/recipients-test", () => ({ sendRecipientsTest: mocks.sendTest }));
// The tenants the platform group of the viewer reaches, which every service call gets.
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reachOf: mocks.reachOf } }));

const actions = await import("@/app/actions/tenant/connection-share");

const SETTINGS = { allTenants: false, tenantIds: ["globex"], encryptedOnly: true, ownRecipients: false };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.granted = new Set();
    mocks.viewer = { id: "u-lena", name: "Lena Graf", tenantId: "acme", allTenants: false };
    mocks.service.view.mockResolvedValue({ uses: [], settings: SETTINGS });
    mocks.service.save.mockResolvedValue({ name: "NAS", kind: "destination", gained: ["Globex"], gainedTenants: [{ tenantId: "globex", name: "Globex" }], losses: [] });
    mocks.reachOf.mockResolvedValue("all");
});

describe("what is shared with customers", () => {
    it("is seen and changed only with the rights of the platform for it, which no group of a tenant gives", () => {
        expect(SEE_SHARING_PERMISSION).toBe(PERMISSIONS.PLATFORM.SHARING_READ);
        expect(SHARE_PERMISSION).toBe(PERMISSIONS.PLATFORM.SHARING_WRITE);
    });

    it("is not read without See what is shared", async () => {
        await expect(actions.getConnectionShare("acme-nas")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.service.view).not.toHaveBeenCalled();
    });

    it("is not changed with See what is shared alone", async () => {
        mocks.granted.add(SEE_SHARING_PERMISSION);
        await expect(actions.saveConnectionShare("acme-nas", SETTINGS)).rejects.toBeInstanceOf(PermissionError);
        await expect(actions.previewShareLoss("acme-nas", SETTINGS)).rejects.toBeInstanceOf(PermissionError);
        await expect(actions.stopSharingWith("acme-nas", "globex", true)).rejects.toBeInstanceOf(PermissionError);
        await expect(actions.deleteSharedBackups("acme-nas", "globex")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.service.save).not.toHaveBeenCalled();
        expect(mocks.service.stopFor).not.toHaveBeenCalled();
        expect(mocks.service.deleteBackupsOf).not.toHaveBeenCalled();
    });

    it("is changed with Share with customers, and logged", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        await expect(actions.saveConnectionShare("acme-nas", SETTINGS)).resolves.toMatchObject({ success: true });
        expect(mocks.service.save).toHaveBeenCalledWith("acme-nas", SETTINGS, { confirmed: false, reach: "all" });
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "UPDATE", "DESTINATION", expect.objectContaining({ name: "NAS", action: "share" }), "acme-nas");
    });

    it("names each tenant that got or lost a connection in an entry of its own, by its id", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        mocks.service.save.mockResolvedValue({
            name: "NAS", kind: "destination", gained: ["Globex", "Initech"],
            gainedTenants: [{ tenantId: "globex", name: "Globex" }, { tenantId: "initech", name: "Initech" }],
            losses: [{ tenantId: "hooli", name: "Hooli", jobs: [], templates: [], backups: 0, used: true, noted: true }],
        });
        await actions.saveConnectionShare("acme-nas", { ...SETTINGS, tenantIds: ["globex", "initech"] }, true);
        const own = mocks.audit.mock.calls.filter((call) => call.length === 5).map((call) => call[3]);
        expect(own).toEqual([
            { name: "NAS", action: "share", tenants: "Globex", tenantId: "globex" },
            { name: "NAS", action: "share", tenants: "Initech", tenantId: "initech" },
            { name: "NAS", action: "unshare", tenants: "Hooli", tenantId: "hooli" },
        ]);
        // The service reads nobody else after the save, so no entry can name a tenant beyond the reach.
        expect(mocks.service.view).not.toHaveBeenCalled();
    });

    it("names the tenant whose backups it deleted by its id, in both logs", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        mocks.service.deleteBackupsOf.mockResolvedValue({ name: "NAS", tenantName: "Globex", backups: 2 });
        await actions.deleteSharedBackups("acme-nas", "globex");
        const details = { name: "NAS", action: "tenantBackups", tenant: "Globex", tenantId: "globex", backups: 2 };
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "DELETE", "DESTINATION", details, "acme-nas");
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "DELETE", "DESTINATION", details, "acme-nas", { tenantId: "globex" });
    });

    it("tells each tenant that lost a connection in its own log", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        mocks.service.save.mockResolvedValue({ name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [{ tenantId: "globex", name: "Globex", jobs: ["Nightly"], templates: [], backups: 3, used: true, noted: true }] });
        await actions.saveConnectionShare("acme-nas", { ...SETTINGS, tenantIds: [] }, true);
        expect(mocks.audit).toHaveBeenCalledWith(
            "u-lena", "UPDATE", "DESTINATION",
            { name: "NAS", action: "unshare", tenants: "Globex", jobs: ["Nightly"], backups: 3 },
            "acme-nas",
            { tenantId: "globex" },
        );
    });

    it("names a tenant that never used a connection shared with every tenant in no log of its own", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        mocks.service.save.mockResolvedValue({ name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [{ tenantId: "hooli", name: "Hooli", jobs: [], templates: [], backups: 0, used: false, noted: false }] });
        await actions.saveConnectionShare("acme-nas", { ...SETTINGS, tenantIds: [] }, true);
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "UPDATE", "DESTINATION", { name: "NAS", action: "unshare", tenants: "Hooli", tenantId: "hooli" }, "acme-nas");
        expect(mocks.audit).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), "acme-nas", { tenantId: "hooli" });
    });

    it("still tells the tenants that lost it when the storage stopped answering on the way", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        const { ShareChangeError } = await import("@/services/sharing/connection-shares");
        mocks.service.save.mockRejectedValue(new ShareChangeError("Could not take it away from a tenant: timeout", {
            name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [{ tenantId: "globex", name: "Globex", jobs: [], templates: [], backups: 2, used: true, noted: true }],
        }));
        await expect(actions.saveConnectionShare("acme-nas", { ...SETTINGS, tenantIds: [] }, true)).resolves.toMatchObject({ success: false, error: "Could not take it away from a tenant: timeout" });
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "UPDATE", "DESTINATION", { name: "NAS", action: "unshare", tenants: "Globex", backups: 2 }, "acme-nas", { tenantId: "globex" });
    });

    it("answers what the storage said with a fixed sentence, never its own words", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        mocks.service.deleteBackupsOf.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.7:22"));
        mocks.service.stopFor.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.7:22"));
        expect(await actions.deleteSharedBackups("acme-nas", "globex")).toEqual({ success: false, error: "The backups could not be deleted." });
        expect(await actions.stopSharingWith("acme-nas", "globex", true)).toEqual({ success: false, error: "The sharing could not be changed." });
    });

    it("hands the tenants the platform group of the viewer reaches to the view and every change", async () => {
        mocks.granted = new Set([SEE_SHARING_PERMISSION, SHARE_PERMISSION]);
        mocks.reachOf.mockResolvedValue(["globex"]);
        mocks.service.losing.mockResolvedValue([]);
        mocks.service.stopFor.mockResolvedValue({ name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [] });
        mocks.service.deleteBackupsOf.mockResolvedValue({ name: "NAS", tenantName: "Globex", backups: 1 });

        await actions.getConnectionShare("acme-nas");
        await actions.previewShareLoss("acme-nas", SETTINGS);
        await actions.saveConnectionShare("acme-nas", SETTINGS, true);
        await actions.stopSharingWith("acme-nas", "globex", true);
        await actions.deleteSharedBackups("acme-nas", "globex");

        expect(mocks.reachOf).toHaveBeenCalledWith("u-lena");
        expect(mocks.service.view).toHaveBeenCalledWith("acme-nas", ["globex"]);
        expect(mocks.service.losing).toHaveBeenCalledWith("acme-nas", { allTenants: false, tenantIds: ["globex"] }, ["globex"]);
        expect(mocks.service.save).toHaveBeenCalledWith("acme-nas", SETTINGS, { confirmed: true, reach: ["globex"] });
        expect(mocks.service.stopFor).toHaveBeenCalledWith("acme-nas", "globex", { confirmed: true, reach: ["globex"] });
        expect(mocks.service.deleteBackupsOf).toHaveBeenCalledWith("acme-nas", "globex", ["globex"]);
    });

    it("is changed in one tenant, never in All tenants", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        mocks.viewer = { ...mocks.viewer, tenantId: null };
        await expect(actions.saveConnectionShare("acme-nas", SETTINGS)).resolves.toMatchObject({ success: false });
        await expect(actions.deleteSharedBackups("acme-nas", "globex")).resolves.toMatchObject({ success: false });
        expect(mocks.service.save).not.toHaveBeenCalled();
        expect(mocks.service.deleteBackupsOf).not.toHaveBeenCalled();
    });

    it("answers every action in All tenants with the refusal of All tenants, before it touches a service", async () => {
        mocks.granted = new Set([SEE_SHARING_PERMISSION, SHARE_PERMISSION, PERMISSIONS.NOTIFICATIONS.WRITE]);
        mocks.viewer = { ...mocks.viewer, tenantId: null, allTenants: true };
        const refused = { success: false, error: "All tenants only reads. Open the tenant of the record to change it." };

        expect(await actions.getConnectionShare("acme-nas")).toEqual(refused);
        expect(await actions.previewShareLoss("acme-nas", SETTINGS)).toEqual(refused);
        expect(await actions.saveConnectionShare("acme-nas", SETTINGS, true)).toEqual(refused);
        expect(await actions.stopSharingWith("acme-nas", "globex", true)).toEqual(refused);
        expect(await actions.deleteSharedBackups("acme-nas", "globex")).toEqual(refused);
        expect(await actions.setChannelRecipients("acme-mail", [])).toEqual(refused);
        expect(await actions.testChannelRecipients("acme-mail")).toEqual(refused);
        expect(mocks.reachOf).not.toHaveBeenCalled();
        expect(mocks.service.view).not.toHaveBeenCalled();
        expect(mocks.setRecipients).not.toHaveBeenCalled();
    });

    it("refuses settings it cannot read", async () => {
        mocks.granted.add(SHARE_PERMISSION);
        await expect(actions.saveConnectionShare("acme-nas", { ...SETTINGS, tenantIds: "globex" } as never)).resolves.toMatchObject({ success: false, error: "Invalid request" });
        await expect(actions.stopSharingWith("acme-nas", "globex", "yes" as never)).resolves.toMatchObject({ success: false });
        expect(mocks.service.save).not.toHaveBeenCalled();
        expect(mocks.service.stopFor).not.toHaveBeenCalled();
    });
});

describe("the recipients of a channel another tenant shares", () => {
    it("are named by whoever may change the channels of the tenant", async () => {
        await expect(actions.setChannelRecipients("acme-mail", ["ops@globex.example"])).rejects.toBeInstanceOf(PermissionError);
        await expect(actions.testChannelRecipients("acme-mail")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.setRecipients).not.toHaveBeenCalled();
        expect(mocks.sendTest).not.toHaveBeenCalled();

        mocks.granted.add(PERMISSIONS.NOTIFICATIONS.WRITE);
        mocks.viewer = { ...mocks.viewer, tenantId: "globex" };
        mocks.setRecipients.mockResolvedValue({ name: "Mail", before: [], after: ["ops@globex.example"] });
        await expect(actions.setChannelRecipients("acme-mail", ["ops@globex.example"])).resolves.toMatchObject({ success: true });
        expect(mocks.setRecipients).toHaveBeenCalledWith("acme-mail", "globex", ["ops@globex.example"]);
    });

    it("write a test that went out into the log with the channel", async () => {
        mocks.granted.add(PERMISSIONS.NOTIFICATIONS.WRITE);
        mocks.sendTest.mockResolvedValue({ name: "Mail", recipients: ["ops@acme.example", "it@acme.example"] });
        await expect(actions.testChannelRecipients("acme-mail")).resolves.toMatchObject({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "EXECUTE", "ADAPTER", { name: "Mail", action: "recipients_test", recipients: 2 }, "acme-mail");
    });

    it("are never shown the reason why the mail server of the other tenant refused a test", async () => {
        mocks.granted.add(PERMISSIONS.NOTIFICATIONS.WRITE);
        mocks.sendTest.mockRejectedValue(new Error("535 Authentication failed for smtp-user@acme.example"));
        const result = await actions.testChannelRecipients("acme-mail");
        expect(result).toEqual({ success: false, error: "The test did not go out. The tenant that shares the channel can see why." });
    });
});
