import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    viewer: { id: "lena", isPlatformAdmin: false, tenantId: "acme" as string | null, allTenants: false },
    rename: vi.fn(),
    saveEvents: vi.fn(),
    saveDefaults: vi.fn(),
    sendTest: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: vi.fn(async () => mocks.viewer) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { rename: mocks.rename, find: vi.fn(async () => ({ id: "acme", name: "Acme GmbH" })) } }));
vi.mock("@/services/notifications/tenant-notification-delivery", () => ({ sendTenantEventTest: mocks.sendTest }));
vi.mock("@/services/notifications/tenant-notification-settings", () => ({ saveTenantEventSettings: mocks.saveEvents, saveTenantDefaultChannels: mocks.saveDefaults }));
vi.mock("@/services/tenant/tenant-settings-audit", () => ({ TENANT_SETTINGS_AREA: "Tenant settings", tenantNotificationChanges: vi.fn(async () => []) }));

const { renameOwnTenant, saveTenantDefaultChannelsAction, saveTenantNotificationEventsAction, sendTenantTestNotificationAction } = await import("@/app/actions/tenant/tenant-settings");

const CONFIG = { defaultChannels: [], events: {} };

describe("the settings of the tenant a page shows", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = { id: "lena", isPlatformAdmin: false, tenantId: "acme", allTenants: false };
        mocks.rename.mockResolvedValue({ name: "Acme AG", renamedFrom: "Acme GmbH" });
        mocks.saveEvents.mockResolvedValue({ before: CONFIG, after: CONFIG });
        mocks.saveDefaults.mockResolvedValue({ before: CONFIG, after: CONFIG });
        mocks.sendTest.mockResolvedValue({ sent: 1, failed: 0 });
    });

    it("changes the tenant the page shows while the session still works in it", async () => {
        expect(await renameOwnTenant("acme", "Acme AG")).toEqual({ success: true });
        expect(await saveTenantDefaultChannelsAction("acme", ["mail"])).toEqual({ success: true });
        expect(await saveTenantNotificationEventsAction("acme", ["restore.failed"], { enabled: false })).toEqual({ success: true });
        expect((await sendTenantTestNotificationAction("acme", "restore.failed")).success).toBe(true);

        // As the tenant itself, whose refusal of a taken name never names another tenant.
        expect(mocks.rename).toHaveBeenCalledWith("acme", "Acme AG", { ownTenant: true });
        expect(mocks.saveDefaults).toHaveBeenCalledWith("acme", ["mail"]);
        expect(mocks.sendTest).toHaveBeenCalledWith("acme", "restore.failed");
    });

    it("refuses a page of the tenant before when another tab switched the session, and changes nothing", async () => {
        // The page still shows Acme, the session works in Globex since a switch in another tab.
        mocks.viewer = { ...mocks.viewer, tenantId: "globex" };
        const refused = { success: false, error: expect.stringContaining("another tab") };

        expect(await renameOwnTenant("acme", "Acme AG")).toEqual(refused);
        expect(await saveTenantDefaultChannelsAction("acme", ["mail"])).toEqual(refused);
        expect(await saveTenantNotificationEventsAction("acme", ["restore.failed"], { enabled: false })).toEqual(refused);
        expect(await sendTenantTestNotificationAction("acme", "restore.failed")).toEqual(refused);

        expect(mocks.rename).not.toHaveBeenCalled();
        expect(mocks.saveDefaults).not.toHaveBeenCalled();
        expect(mocks.saveEvents).not.toHaveBeenCalled();
        expect(mocks.sendTest).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("refuses All tenants, which changes no tenant", async () => {
        mocks.viewer = { ...mocks.viewer, tenantId: null, allTenants: true };

        expect(await renameOwnTenant("acme", "Acme AG")).toEqual({ success: false, error: "Open a tenant to change its settings." });
        expect(mocks.rename).not.toHaveBeenCalled();
    });

    it("sends no test of the home tenant, which reports through the notifications of the platform", async () => {
        mocks.viewer = { ...mocks.viewer, tenantId: "default" };

        expect(await sendTenantTestNotificationAction("default", "restore.failed")).toEqual({ success: false, error: "The home tenant reports through the notifications of the platform." });
        expect(mocks.sendTest).not.toHaveBeenCalled();
    });
});
