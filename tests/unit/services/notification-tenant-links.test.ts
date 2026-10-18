import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { NOTIFICATION_EVENTS, type NotificationEventData, type NotificationPayload } from "@/lib/notifications/types";
import { tenantNotificationKey } from "@/services/notifications/tenant-notification-settings";

const mocks = vi.hoisted(() => ({ send: vi.fn(), current: vi.fn() }));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/notifications/brand", () => ({ loadNotificationBrand: async () => ({ instanceName: null, baseUrl: null, timeZone: "UTC" }) }));
vi.mock("@/lib/tenant/current", () => ({ currentTenantId: () => mocks.current() }));
vi.mock("@/services/notifications/channel-send", () => ({
    EMAIL_ADAPTER_IDS: ["email"],
    sendThroughChannel: (...args: unknown[]) => mocks.send(...args),
}));
vi.mock("@/services/sharing/provided", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/sharing/provided")>()),
    providedTo: async () => [],
}));

const { notify } = await import("@/services/notifications/system-notification-service");

const ACME = "t-acme";

function channel(id: string, tenantId: string) {
    return { id, name: id, adapterId: "discord", type: "notification", config: "{}", primaryCredentialId: null, sshCredentialId: null, tenantId } as never;
}

function stored(settings: Record<string, unknown>) {
    prismaMock.systemSetting.findUnique.mockImplementation((async (args: { where: { key: string } }) => {
        const value = settings[args.where.key];
        return value === undefined ? null : { key: args.where.key, value: JSON.stringify(value), description: null, updatedAt: new Date() };
    }) as never);
}

/** Each send as the channel it went through, the links of its message and the run its log row keeps. */
function sends() {
    return mocks.send.mock.calls.map((call) => ({
        channel: (call[0] as { id: string }).id,
        links: ((call[1] as NotificationPayload).actions ?? []).map((action) => action.href),
        executionId: (call[4] as { executionId?: string } | undefined)?.executionId,
    }));
}

const restoreFailed: NotificationEventData = {
    eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE,
    data: { sourceName: "Shop", executionId: "run-acme", error: "boom", timestamp: "2026-10-15T10:00:00.000Z" },
};
const checkFailed: NotificationEventData = {
    eventType: NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE,
    data: { totalFiles: 1, failed: 1, passed: 0, skipped: 0, triggerType: "Manual", errors: [{ file: "a.tar", destination: "NAS", expected: "x", actual: "y" }] },
};

describe("the links of a notification and the run its log keeps", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.send.mockResolvedValue(undefined);
        mocks.current.mockResolvedValue(null);
        stored({
            "notifications.config": { globalChannels: ["ops"], events: { restore_failure: { enabled: true, channels: null }, integrity_check_failure: { enabled: true, channels: null } } },
            [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: { restore_failure: { enabled: true, channels: null }, integrity_check_failure: { enabled: true, channels: null } } },
        });
        prismaMock.adapterConfig.findMany.mockImplementation((async (args: { where: { id: { in: string[] } } }) =>
            args.where.id.in.includes("ops") ? [channel("ops", HOME_TENANT_ID)] : [channel("teams", ACME)]) as never);
    });

    it("name the customer's tenant in the platform's message and in the customer's own", async () => {
        prismaMock.execution.findUnique.mockResolvedValue({ tenantId: ACME } as never);

        await notify(restoreFailed);

        expect(sends().map(({ channel: id, links }) => [id, links])).toEqual([
            ["ops", ["/dashboard/history/run?id=run-acme&from=history&tenant=t-acme"]],
            ["teams", ["/dashboard/history/run?id=run-acme&from=history&tenant=t-acme"]],
        ]);
    });

    it("name the home tenant for a run of the home tenant", async () => {
        prismaMock.execution.findUnique.mockResolvedValue({ tenantId: HOME_TENANT_ID } as never);

        await notify(restoreFailed);

        expect(sends()).toEqual([{ channel: "ops", links: ["/dashboard/history/run?id=run-acme&from=history&tenant=default"], executionId: undefined }]);
    });

    it("keep a customer's run out of the platform's log, where Open run would find nothing, and in the customer's", async () => {
        // A check of a customer's backup, started from its page.
        prismaMock.execution.findUnique.mockResolvedValue({ tenantId: ACME } as never);

        await notify(checkFailed, { executionId: "check-acme" });

        expect(sends().map(({ channel: id, executionId }) => [id, executionId])).toEqual([["ops", undefined], ["teams", "check-acme"]]);
    });

    it("keep a run of the home tenant in the platform's log", async () => {
        prismaMock.execution.findUnique.mockResolvedValue({ tenantId: HOME_TENANT_ID } as never);

        await notify(checkFailed, { executionId: "check-home" });

        expect(sends()).toEqual([{ channel: "ops", links: ["/dashboard/backups?tenant=default"], executionId: "check-home" }]);
    });
});
