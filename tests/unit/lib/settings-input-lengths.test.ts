// @vitest-environment node
/**
 * The ids the notification settings and the retention preview take from the browser have a
 * length, so a request of the wrong size is refused before a service sees it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    saveEventSettings: vi.fn(),
    saveDefaultChannels: vi.fn(),
    sendEventTest: vi.fn(),
    getRetentionTargets: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: async () => ({ id: "ada", isPlatformAdmin: true, tenantId: "default", permissions: ["jobs:read", "templates:read"] }),
    tenantRefusal: () => null,
}));
vi.mock("@/lib/tenant/context", () => ({ runAsTenant: (_tenantId: string, fn: () => unknown) => fn() }));
vi.mock("@/services/system/settings-save", () => ({ PLATFORM_LOG: { tenantId: "default" } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));
vi.mock("@/services/notifications/notification-settings-audit", () => ({ notificationSettingsChanges: () => [] }));
vi.mock("@/services/system/settings-audit", () => ({ SETTINGS_AREAS: {} }));
vi.mock("@/services/notifications/notification-settings-service", () => ({
    MAX_REMINDER_HOURS: 720,
    saveEventSettings: mocks.saveEventSettings,
    saveDefaultChannels: mocks.saveDefaultChannels,
    sendEventTest: mocks.sendEventTest,
}));
vi.mock("@/services/templates/retention-targets", () => ({ getRetentionTargets: mocks.getRetentionTargets }));

const { saveDefaultChannelsAction, saveNotificationEventsAction, sendTestNotificationAction } = await import("@/app/actions/settings/notification-settings");
const { getRetentionPolicyTargets } = await import("@/app/actions/templates-retention");

const LONG = "x".repeat(10_000);

describe("the length of the ids the browser sends", () => {
    beforeEach(() => vi.clearAllMocks());

    it("refuses an event or channel id far longer than any id", async () => {
        expect((await saveNotificationEventsAction([LONG], { enabled: true })).success).toBe(false);
        expect((await saveNotificationEventsAction(["BACKUP_FAILURE"], { channels: [LONG] })).success).toBe(false);
        expect((await saveDefaultChannelsAction([LONG])).success).toBe(false);
        expect((await sendTestNotificationAction(LONG)).success).toBe(false);
        expect(mocks.saveEventSettings).not.toHaveBeenCalled();
        expect(mocks.saveDefaultChannels).not.toHaveBeenCalled();
        expect(mocks.sendEventTest).not.toHaveBeenCalled();
    });

    it("refuses a retention policy id far longer than any id", async () => {
        expect(await getRetentionPolicyTargets({ policyId: LONG })).toEqual({ success: false, error: "Invalid request" });
        expect(mocks.getRetentionTargets).not.toHaveBeenCalled();
    });
});
