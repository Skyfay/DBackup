import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({
    save: vi.fn(),
    load: vi.fn(),
    audit: vi.fn(),
    notify: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: vi.fn(async () => ({ id: "manu" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/notifications/system-notification-service", () => ({
    getNotificationConfig: (...args: unknown[]) => mocks.load(...args),
    saveNotificationConfig: (...args: unknown[]) => mocks.save(...args),
    notify: (...args: unknown[]) => mocks.notify(...args),
}));
vi.mock("@/services/notifications/notification-settings-audit", () => ({ notificationSettingsChanges: vi.fn(async () => []) }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));

const { saveNotificationEventsAction, saveDefaultChannelsAction, sendTestNotificationAction } = await import("@/app/actions/settings/notification-settings");

const savedEvent = () => mocks.save.mock.calls.at(-1)?.[0].events.storage_usage_spike;

describe("saving the notification settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.load.mockResolvedValue({ globalChannels: ["channel-1"], events: {} });
        prismaMock.adapterConfig.count.mockResolvedValue(1 as never);
    });

    it("keeps the reminder interval picked for an event", async () => {
        expect(await saveNotificationEventsAction(["storage_usage_spike"], { reminderHours: 48 })).toEqual({ success: true });

        expect(savedEvent()).toEqual({ enabled: true, channels: null, reminderIntervalHours: 48 });
    });

    it("keeps a reminder turned off and one left at the default", async () => {
        await saveNotificationEventsAction(["storage_usage_spike"], { reminderHours: 0 });
        expect(savedEvent().reminderIntervalHours).toBe(0);

        await saveNotificationEventsAction(["storage_usage_spike"], { reminderHours: null });
        expect(savedEvent().reminderIntervalHours).toBeNull();
    });

    it("turns down an interval that is no number of hours", async () => {
        expect(await saveNotificationEventsAction(["storage_usage_spike"], { reminderHours: -6 })).toMatchObject({ success: false });
        expect(await saveNotificationEventsAction(["storage_usage_spike"], { reminderHours: 1.5 })).toMatchObject({ success: false });
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it("refuses own channels without a channel instead of falling back to the default ones", async () => {
        expect(await saveNotificationEventsAction(["storage_usage_spike"], { channels: [] })).toMatchObject({ success: false, field: "channels" });
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it("saves the same change of several events at once", async () => {
        await saveNotificationEventsAction(["restore_complete", "restore_failure"], { enabled: false });

        expect(mocks.save).toHaveBeenCalledTimes(1);
        const events = mocks.save.mock.calls[0][0].events;
        expect(events.restore_complete.enabled).toBe(false);
        expect(events.restore_failure.enabled).toBe(false);
    });

    it("refuses an event that does not exist and a channel that is gone", async () => {
        expect(await saveNotificationEventsAction(["no_such_event"], { enabled: true })).toMatchObject({ success: false });
        prismaMock.adapterConfig.count.mockResolvedValue(0 as never);
        expect(await saveDefaultChannelsAction(["gone"])).toMatchObject({ success: false, field: "channels" });
        expect(mocks.save).not.toHaveBeenCalled();
    });
});

describe("a test notification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("sends while the event is off and says how many channels took it", async () => {
        mocks.notify.mockResolvedValue({ succeeded: 2, failed: 1 });

        expect(await sendTestNotificationAction("restore_complete")).toEqual({ success: true, message: "Sent to 2 channels, 1 channel did not take it" });
        expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "restore_complete" }), { test: true });
    });

    it("reports nothing sent as a failure, which it called a success before", async () => {
        mocks.notify.mockResolvedValue({ succeeded: 0, failed: 0 });
        expect(await sendTestNotificationAction("restore_complete")).toMatchObject({ success: false });

        mocks.notify.mockResolvedValue(undefined);
        expect(await sendTestNotificationAction("restore_complete")).toMatchObject({ success: false });
    });
});
