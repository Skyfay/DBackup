import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { explicitScope } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { NOTIFICATION_EVENTS, type NotificationEventData } from "@/lib/notifications/types";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    send: vi.fn(),
    options: vi.fn(),
    current: vi.fn(),
    provided: vi.fn(),
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/dto", () => ({ getAdapterOptions: (...args: unknown[]) => mocks.options(...args) }));
vi.mock("@/lib/notifications/brand", () => ({ loadNotificationBrand: async () => ({ instanceName: null, baseUrl: null, timeZone: "UTC" }) }));
vi.mock("@/lib/tenant/current", () => ({ currentTenantId: () => mocks.current() }));
vi.mock("@/services/notifications/channel-send", () => ({
    EMAIL_ADAPTER_IDS: ["email"],
    sendThroughChannel: (...args: unknown[]) => mocks.send(...args),
}));
// The channels other tenants share with a tenant, which the sharing module reads across tenants.
vi.mock("@/services/sharing/provided", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/sharing/provided")>()),
    providedTo: (...args: unknown[]) => mocks.provided(...args),
}));

const { getTenantNotificationConfig, getTenantNotificationsModel, saveTenantDefaultChannels, saveTenantEventSettings, tenantHearsAbout, tenantNotificationKey } =
    await import("@/services/notifications/tenant-notification-settings");
const { deliverToTenant, eventTenant, sendTenantEventTest } = await import("@/services/notifications/tenant-notification-delivery");
const { notify } = await import("@/services/notifications/system-notification-service");

const ACME = "t-acme";
/** The tenant of the MSP, which shares a channel of its own with its customers. */
const MSP = "t-msp";

/** A channel the MSP shares with ACME, as the sharing module reports it. */
function sharedChannel(id: string) {
    return { id, name: id, type: "notification", adapterId: "discord", providerId: MSP, providerName: "MSP", allTenants: false, encryptedOnly: false, ownRecipients: false };
}

/** A notification channel of a tenant, as the database keeps it. */
function channel(id: string, tenantId = ACME) {
    return { id, name: id, adapterId: "discord", type: "notification", config: "{}", primaryCredentialId: null, sshCredentialId: null, tenantId } as never;
}

/** The settings as stored, the platform's and the ones of each tenant by key. */
function stored(settings: Record<string, unknown>) {
    prismaMock.systemSetting.findUnique.mockImplementation((async (args: { where: { key: string } }) => {
        const value = settings[args.where.key];
        return value === undefined ? null : { key: args.where.key, value: JSON.stringify(value), description: null, updatedAt: new Date() };
    }) as never);
}

const restoreDone: NotificationEventData = {
    eventType: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
    data: { sourceName: "Shop", targetDatabase: "shop", executionId: "run-1", timestamp: "2026-10-15T10:00:00.000Z" },
};
const offline: NotificationEventData = {
    eventType: NOTIFICATION_EVENTS.CONNECTION_OFFLINE,
    data: { adapterName: "NAS", adapterType: "storage", adapterId: "sftp", configId: "nas", consecutiveFailures: 3, timestamp: "2026-10-15T10:00:00.000Z" },
};

describe("the notifications a tenant keeps", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stored({});
        mocks.provided.mockResolvedValue([]);
    });

    it("keeps each tenant apart, under a key of its own", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: {} } });

        expect(tenantNotificationKey(ACME)).toBe("notifications.tenant.t-acme");
        expect((await getTenantNotificationConfig(ACME)).globalChannels).toEqual(["teams"]);
        expect((await getTenantNotificationConfig("t-shop")).globalChannels).toEqual([]);
    });

    it("drops what a tenant may not hear about, like the sign-ins of the platform", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: [], events: { user_login: { enabled: true, channels: null }, backup_failure: { enabled: true, channels: ["mail"] } } } });

        expect(Object.keys((await getTenantNotificationConfig(ACME)).events)).toEqual(["backup_failure"]);
    });

    it("lists every event of the tenant's own data without reminders or mails to a person, with its own channels read in the tenant", async () => {
        let scope: unknown = null;
        mocks.options.mockImplementation(async () => {
            scope = explicitScope();
            return [{ id: "teams", name: "Acme Teams", adapterId: "teams" }];
        });

        const model = await getTenantNotificationsModel(ACME);

        expect(scope).toEqual({ kind: "tenant", tenantId: ACME });
        expect(model.events.map((event) => event.id)).toEqual(expect.arrayContaining(["backup_failure", "backup_partial", "backup_success", "restore_complete", "connection_offline", "integrity_check_failure"]));
        expect(model.events.map((event) => event.id)).not.toContain("user_login");
        expect(model.events.every((event) => event.notifyUser === null && !event.supportsReminder)).toBe(true);
        // A failed backup reports once a channel is set, a successful one only when switched on.
        expect(model.events.find((event) => event.id === "backup_failure")?.enabled).toBe(true);
        expect(model.events.find((event) => event.id === "backup_success")?.enabled).toBe(false);
    });

    it("saves the same change of several events and leaves the others as they are", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: { restore_failure: { enabled: false, channels: null } } } });
        prismaMock.adapterConfig.count.mockResolvedValue(1);

        const { after } = await saveTenantEventSettings(ACME, ["backup_success", "backup_partial"], { enabled: true, channels: ["mail"] });

        expect(after.events).toEqual({
            restore_failure: { enabled: false, channels: null },
            backup_success: { enabled: true, channels: ["mail"] },
            backup_partial: { enabled: true, channels: ["mail"] },
        });
        expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "notifications.tenant.t-acme" } }));
    });

    it("refuses a channel the tenant does not have, an event of the platform and own channels without any", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(0);

        await expect(saveTenantDefaultChannels(ACME, ["channel-of-another-tenant"])).rejects.toBeInstanceOf(ValidationError);
        await expect(saveTenantEventSettings(ACME, ["update_available"], { enabled: true })).rejects.toThrow(/Unknown notification event/);
        await expect(saveTenantEventSettings(ACME, ["backup_failure"], { channels: [] })).rejects.toThrow(/at least one channel/);
        expect(prismaMock.systemSetting.upsert).not.toHaveBeenCalled();
        // The channels are counted in the tenant, so one of another tenant is not found.
        expect(prismaMock.adapterConfig.count).toHaveBeenCalledWith({ where: { id: { in: ["channel-of-another-tenant"] }, type: "notification", tenantId: ACME } });
    });

    it("takes a channel another tenant shares with it beside its own", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(1);
        mocks.provided.mockResolvedValue([sharedChannel("msp-alerts")]);

        const { after } = await saveTenantDefaultChannels(ACME, ["teams", "msp-alerts"]);

        expect(after.globalChannels).toEqual(["teams", "msp-alerts"]);
        expect(mocks.provided).toHaveBeenCalledWith(ACME, { kind: "channel", ids: ["teams", "msp-alerts"] });
    });

    it("says whether a tenant hears about an event before anything is gathered for it", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: { backup_success: { enabled: false, channels: null } } } });

        expect(await tenantHearsAbout(ACME, NOTIFICATION_EVENTS.BACKUP_FAILURE)).toBe(true);
        expect(await tenantHearsAbout(ACME, NOTIFICATION_EVENTS.BACKUP_SUCCESS)).toBe(false);
        expect(await tenantHearsAbout("t-shop", NOTIFICATION_EVENTS.BACKUP_FAILURE)).toBe(false);
        expect(await tenantHearsAbout(HOME_TENANT_ID, NOTIFICATION_EVENTS.BACKUP_FAILURE)).toBe(false);
    });
});

describe("the tenant an event is about", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.current.mockResolvedValue(null);
    });

    it("finds it by the connection the event names", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ tenantId: ACME } as never);

        expect(await eventTenant(offline)).toBe(ACME);
        expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalledWith({ where: { id: "nas" }, select: { tenantId: true } });
    });

    it("finds it by the run, like a restore of a shared database that belongs to the customer", async () => {
        prismaMock.execution.findUnique.mockResolvedValue({ tenantId: ACME } as never);

        expect(await eventTenant(restoreDone)).toBe(ACME);
    });

    it("takes the tenant a caller names, and the tenant the code runs for without anything else", async () => {
        expect(await eventTenant(offline, { tenantId: "t-shop" })).toBe("t-shop");
        mocks.current.mockResolvedValue(ACME);
        expect(await eventTenant({ eventType: NOTIFICATION_EVENTS.BACKUP_FAILURE, data: { jobName: "Nightly", timestamp: "x" } })).toBe(ACME);
    });

    it("has none for the home tenant, which the platform covers, nor for an event of the platform alone", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ tenantId: HOME_TENANT_ID } as never);
        expect(await eventTenant(offline)).toBeNull();
        expect(await eventTenant({ eventType: NOTIFICATION_EVENTS.USER_LOGIN, data: { userName: "Ada", email: "ada@example.ch", timestamp: "x" } }, { tenantId: ACME })).toBeNull();
    });
});

describe("delivering an event to the channels of a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.send.mockResolvedValue(undefined);
        mocks.current.mockResolvedValue(null);
        mocks.provided.mockResolvedValue([]);
    });

    it("sends to the default channels of the tenant, read in that tenant, while the event is on", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams", "mail"], events: {} } });
        let scope: unknown = null;
        prismaMock.adapterConfig.findMany.mockImplementation((async () => {
            scope = explicitScope();
            return [channel("teams"), channel("mail")];
        }) as never);

        expect(await deliverToTenant(offline, ACME)).toEqual({ succeeded: 2, failed: 0 });
        expect(scope).toEqual({ kind: "tenant", tenantId: ACME });
        expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith({ where: { id: { in: ["teams", "mail"] }, type: "notification", tenantId: ACME } });
        expect(mocks.send.mock.calls[0][1]).toMatchObject({ reason: 'You get this because "A connection is offline" is on in the tenant settings under Notifications.' });
    });

    it("sends to the own channels of an event, and nothing for an event that is off or a tenant without channels", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: { connection_offline: { enabled: true, channels: ["pager"] }, restore_complete: { enabled: false, channels: null } } } });
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("pager")]);

        expect(await deliverToTenant(offline, ACME)).toEqual({ succeeded: 1, failed: 0 });
        expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["pager"] } }) }));
        expect(await deliverToTenant(restoreDone, ACME)).toBeUndefined();
        expect(await deliverToTenant(offline, "t-shop")).toBeUndefined();
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it("sends once to a channel the job of the run told already, and nothing when it was the only one", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams", "mail"], events: {} } });
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("mail")]);

        expect(await deliverToTenant(offline, ACME, { skipChannelIds: ["teams"] })).toEqual({ succeeded: 1, failed: 0 });
        expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["mail"] } }) }));
        expect(await deliverToTenant(offline, ACME, { skipChannelIds: ["teams", "mail"] })).toBeUndefined();
    });

    it("also sends through a channel another tenant shares with it, for the tenant, so it goes where the tenant named", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams", "msp-alerts"], events: {} } });
        mocks.provided.mockResolvedValue([sharedChannel("msp-alerts")]);
        let sharedScope: unknown = null;
        prismaMock.adapterConfig.findMany.mockImplementation((async (args: { where: { tenantId?: string } }) => {
            if (args.where.tenantId === ACME) return [channel("teams")];
            sharedScope = explicitScope();
            return [channel("msp-alerts", MSP)];
        }) as never);

        expect(await deliverToTenant(offline, ACME)).toEqual({ succeeded: 2, failed: 0 });
        expect(mocks.provided).toHaveBeenCalledWith(ACME, { kind: "channel", ids: ["teams", "msp-alerts"] });
        // The channel stays in the tenant that shares it, so only the system scope reads it.
        expect(sharedScope).toEqual({ kind: "system" });
        expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith({ where: { id: { in: ["msp-alerts"] }, type: "notification" } });
        expect(mocks.send.mock.calls.map((call) => [(call[0] as { id: string }).id, (call[4] as { tenantId?: string }).tenantId])).toEqual([["teams", ACME], ["msp-alerts", ACME]]);
    });

    it("never sends for the home tenant, whose data the notifications of the platform cover", async () => {
        stored({ [tenantNotificationKey(HOME_TENANT_ID)]: { globalChannels: ["teams"], events: {} } });

        expect(await deliverToTenant(offline, HOME_TENANT_ID)).toBeUndefined();
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("counts a channel that does not take it, and goes on to the next", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams", "mail"], events: {} } });
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("teams"), channel("mail")]);
        mocks.send.mockRejectedValueOnce(new Error("Webhook gone"));

        expect(await deliverToTenant(offline, ACME)).toEqual({ succeeded: 1, failed: 1 });
    });

    it("sends a test while the event is off, and refuses one with nowhere to go", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: { backup_success: { enabled: false, channels: null } } } });
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("teams")]);

        expect(await sendTenantEventTest(ACME, NOTIFICATION_EVENTS.BACKUP_SUCCESS)).toEqual({ sent: 1, failed: 0 });
        await expect(sendTenantEventTest("t-shop", NOTIFICATION_EVENTS.BACKUP_SUCCESS)).rejects.toThrow(/no channel/);
        await expect(sendTenantEventTest(HOME_TENANT_ID, NOTIFICATION_EVENTS.BACKUP_SUCCESS)).rejects.toThrow(/platform/);
    });
});

describe("notify, the platform first and then the tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.send.mockResolvedValue(undefined);
        mocks.current.mockResolvedValue(null);
        mocks.provided.mockResolvedValue([]);
    });

    it("sends an event of a customer to the platform's channels and to the customer's own", async () => {
        stored({
            "notifications.config": { globalChannels: ["ops"], events: {} },
            [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: {} },
        });
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ tenantId: ACME } as never);
        prismaMock.adapterConfig.findMany.mockImplementation((async (args: { where: { id: { in: string[] } } }) =>
            args.where.id.in.includes("ops") ? [channel("ops", HOME_TENANT_ID)] : [channel("teams")]) as never);

        expect(await notify(offline)).toEqual({ succeeded: 2, failed: 0 });
        expect(mocks.send.mock.calls.map((call) => (call[0] as { id: string }).id)).toEqual(["ops", "teams"]);
    });

    it("sends an event of the home tenant to the platform alone", async () => {
        stored({
            "notifications.config": { globalChannels: ["ops"], events: {} },
            [tenantNotificationKey(HOME_TENANT_ID)]: { globalChannels: ["teams"], events: {} },
        });
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ tenantId: HOME_TENANT_ID } as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("ops", HOME_TENANT_ID)]);

        expect(await notify(offline)).toEqual({ succeeded: 1, failed: 0 });
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it("reaches the tenant even while the platform has the event off, so a skip is not reported again", async () => {
        stored({
            "notifications.config": { globalChannels: ["ops"], events: { connection_offline: { enabled: false, channels: null } } },
            [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: {} },
        });
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ tenantId: ACME } as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("teams")]);

        expect(await notify(offline)).toEqual({ succeeded: 1, failed: 0 });
    });

    it("sends the run of a job only to the tenant, which the platform hears about through the job", async () => {
        stored({ [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: {} } });
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("teams")]);

        const run: NotificationEventData = { eventType: NOTIFICATION_EVENTS.BACKUP_FAILURE, data: { jobName: "Nightly", timestamp: "2026-10-15T10:00:00.000Z" } };
        expect(await notify(run, { tenantId: ACME, platform: false })).toEqual({ succeeded: 1, failed: 0 });
        // The platform's settings are never read for it.
        expect(prismaMock.systemSetting.findUnique).not.toHaveBeenCalledWith({ where: { key: "notifications.config" } });
    });

    it("keeps a test of the platform away from the tenants", async () => {
        stored({
            "notifications.config": { globalChannels: ["ops"], events: {} },
            [tenantNotificationKey(ACME)]: { globalChannels: ["teams"], events: {} },
        });
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ tenantId: ACME } as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([channel("ops", HOME_TENANT_ID)]);

        expect(await notify(offline, { test: true })).toEqual({ succeeded: 1, failed: 0 });
        expect(prismaMock.adapterConfig.findUnique).not.toHaveBeenCalled();
    });
});
