import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/notifications/templates";
import { NOTIFICATION_EVENTS, type NotificationEventData } from "@/lib/notifications/types";

const AT = "2026-10-15T10:00:00.000Z";

const hrefs = (event: NotificationEventData, tenantId?: string) =>
    (renderTemplate(event, { timeZone: "UTC", tenantId }).actions ?? []).map((action) => action.href);

describe("the links of a notification", () => {
    it("name the tenant of the run and the job of a backup, so they open there from another tenant", () => {
        const failed: NotificationEventData = { eventType: NOTIFICATION_EVENTS.BACKUP_FAILURE, data: { jobName: "Nightly", jobId: "j1", executionId: "r1", timestamp: AT } };

        expect(hrefs(failed, "t-acme")).toEqual([
            "/dashboard/history/run?id=r1&from=history&tenant=t-acme",
            "/dashboard/jobs?job=j1&tenant=t-acme",
        ]);
    });

    it("name the tenant of a restore, a destination and a connection", () => {
        const restore: NotificationEventData = { eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE, data: { sourceName: "Shop", executionId: "r2", error: "boom", timestamp: AT } };
        const missing: NotificationEventData = { eventType: NOTIFICATION_EVENTS.STORAGE_MISSING_BACKUP, data: { storageName: "NAS", storageId: "s1", thresholdHours: 24, hoursSinceLastBackup: 30, timestamp: AT } };
        const offline: NotificationEventData = { eventType: NOTIFICATION_EVENTS.CONNECTION_OFFLINE, data: { adapterName: "NAS", adapterType: "storage", adapterId: "sftp", configId: "c1", consecutiveFailures: 3, timestamp: AT } };
        const skipped: NotificationEventData = { eventType: NOTIFICATION_EVENTS.AIRGAP_SKIPPED, data: { storageName: "USB", storageId: "u1", jobName: "Nightly", jobId: "j1", timestamp: AT } };

        expect(hrefs(restore, "default")).toEqual(["/dashboard/history/run?id=r2&from=history&tenant=default"]);
        expect(hrefs(missing, "t-acme")).toEqual(["/dashboard/backups?tab=destinations&destination=s1&tenant=t-acme"]);
        expect(hrefs(offline, "t-acme")).toEqual(["/dashboard/connections?tab=destinations&open=c1&tenant=t-acme"]);
        expect(hrefs(skipped, "t-acme")).toEqual(["/dashboard/connections?tab=destinations&open=u1&tenant=t-acme", "/dashboard/jobs?job=j1&tenant=t-acme"]);
    });

    it("stay as they were when the sender knows no tenant", () => {
        const done: NotificationEventData = { eventType: NOTIFICATION_EVENTS.BACKUP_SUCCESS, data: { jobName: "Nightly", jobId: "j1", executionId: "r1", timestamp: AT } };

        expect(hrefs(done)).toEqual(["/dashboard/history/run?id=r1&from=history"]);
    });
});
