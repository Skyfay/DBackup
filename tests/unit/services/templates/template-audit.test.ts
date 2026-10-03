import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { templateSnapshot, templateUpdate } from "@/services/templates/template-audit";

const policy = (name: string, config: unknown) => ({ id: "p-1", name, description: null, config: JSON.stringify(config), isDefault: false, isSystem: false });

describe("what the audit log keeps of a changed template", () => {
    beforeEach(() => vi.clearAllMocks());

    it("writes the tiers of a retention policy that changed, in numbers", async () => {
        prismaMock.retentionPolicy.findUnique
            .mockResolvedValueOnce(policy("Keep a month", { mode: "SMART", smart: { daily: 7, weekly: 4, monthly: 12, yearly: 0 } }) as never)
            .mockResolvedValueOnce(policy("Keep a month", { mode: "SMART", smart: { hourly: 24, daily: 14, weekly: 4, monthly: 12, yearly: 0 } }) as never);

        const before = await templateSnapshot("RetentionPolicy", "p-1");
        const details = templateUpdate("RetentionPolicy", before, await templateSnapshot("RetentionPolicy", "p-1"));

        expect(details).toEqual({
            type: "RetentionPolicy",
            name: "Keep a month",
            changes: [
                { field: "Hourly", from: null, to: "24" },
                { field: "Daily", from: "7", to: "14" },
            ],
        });
    });

    it("writes a new way of keeping backups in the words of the policy dialog, and a rename", async () => {
        prismaMock.retentionPolicy.findUnique
            .mockResolvedValueOnce(policy("Last 5", { mode: "SIMPLE", simple: { keepCount: 5 } }) as never)
            .mockResolvedValueOnce(policy("Everything", { mode: "NONE" }) as never);

        const before = await templateSnapshot("RetentionPolicy", "p-1");
        const details = templateUpdate("RetentionPolicy", before, await templateSnapshot("RetentionPolicy", "p-1"));

        expect(details).toEqual({
            type: "RetentionPolicy",
            name: "Everything",
            renamedFrom: "Last 5",
            changes: [
                { field: "Keeps", from: "The last few", to: "Everything" },
                { field: "Last backups kept", from: "5", to: null },
            ],
        });
    });

    it("names the channels of a notification template with the runs they report", async () => {
        const template = (channels: { events: string; config: { name: string } }[]) => ({ id: "t-1", name: "Ops", description: null, isDefault: false, isSystem: false, channels });
        prismaMock.notificationTemplate.findUnique
            .mockResolvedValueOnce(template([{ events: "SUCCESS|FAILED", config: { name: "Slack" } }]) as never)
            .mockResolvedValueOnce(template([{ events: "SUCCESS|FAILED", config: { name: "Slack" } }, { events: "FAILED", config: { name: "Email" } }]) as never);

        const before = await templateSnapshot("NotificationTemplate", "t-1");
        const details = templateUpdate("NotificationTemplate", before, await templateSnapshot("NotificationTemplate", "t-1"));

        expect(details.changes).toEqual([{ field: "Channels", from: "Slack (success, failed)", to: "Slack (success, failed), Email (failed)" }]);
    });

    it("keeps the name without changes when the template could not be read after the change", () => {
        expect(templateUpdate("SchedulePreset", { name: "Nightly", values: { schedule: "0 3 * * *" } }, null)).toEqual({ type: "SchedulePreset", name: "Nightly", changes: [] });
    });
});
