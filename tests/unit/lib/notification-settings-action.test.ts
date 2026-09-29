import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    save: vi.fn(),
    load: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: vi.fn(async () => ({ id: "manu" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/notifications/system-notification-service", () => ({
    getNotificationConfig: (...args: unknown[]) => mocks.load(...args),
    saveNotificationConfig: (...args: unknown[]) => mocks.save(...args),
    getAvailableChannels: vi.fn(async () => []),
}));
vi.mock("@/services/notifications/notification-settings-audit", () => ({ notificationSettingsChanges: vi.fn(async () => []) }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));

const { updateNotificationSettings } = await import("@/app/actions/settings/notification-settings");

const withReminder = (reminderIntervalHours: number | null) => ({
    globalChannels: ["channel-1"],
    events: { storage_usage_spike: { enabled: true, channels: null, reminderIntervalHours } },
});

describe("saving the notification settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.load.mockResolvedValue({ globalChannels: [], events: {} });
    });

    it("keeps the reminder interval picked for an event", async () => {
        expect(await updateNotificationSettings(withReminder(48))).toEqual({ success: true });

        expect(mocks.save).toHaveBeenCalledWith(withReminder(48));
    });

    it("keeps a reminder turned off and one left at the default", async () => {
        await updateNotificationSettings(withReminder(0));
        await updateNotificationSettings(withReminder(null));

        expect(mocks.save).toHaveBeenNthCalledWith(1, withReminder(0));
        expect(mocks.save).toHaveBeenNthCalledWith(2, withReminder(null));
    });

    it("turns down an interval that is no number of hours", async () => {
        expect(await updateNotificationSettings(withReminder(-6))).toMatchObject({ success: false });
        expect(await updateNotificationSettings(withReminder(1.5))).toMatchObject({ success: false });
        expect(mocks.save).not.toHaveBeenCalled();
    });
});
