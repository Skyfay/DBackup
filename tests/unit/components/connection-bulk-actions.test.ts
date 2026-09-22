import { describe, it, expect } from "vitest";
import { connectionBulkActions, deleteBlocker } from "@/components/adapter/connection-bulk-actions";
import type { AdapterConfig } from "@/components/adapter/types";

const config = (id: string, metadata: Record<string, unknown> = {}): AdapterConfig => ({
    id,
    name: id,
    adapterId: "postgres",
    type: "database",
    config: "{}",
    metadata: JSON.stringify(metadata),
    createdAt: "2026-09-01T00:00:00.000Z",
});

const available = (rows: AdapterConfig[]) =>
    connectionBulkActions("database", true)
        .filter((action) => action.isAvailable?.(rows) ?? true)
        .map((action) => action.id);

describe("connectionBulkActions", () => {
    it("only offers the change that would do something for the selection", () => {
        expect(available([config("a"), config("b")])).toEqual(["delete", "disable-health-alerts", "exclude-from-restore"]);
        expect(available([config("a", { healthNotificationsDisabled: true, isRestoreExcluded: true })])).toEqual([
            "delete",
            "enable-health-alerts",
            "include-in-restore",
        ]);
    });

    it("offers both directions for a mixed selection", () => {
        expect(available([config("a"), config("b", { healthNotificationsDisabled: true })])).toContain("enable-health-alerts");
        expect(available([config("a"), config("b", { healthNotificationsDisabled: true })])).toContain("disable-health-alerts");
    });

    it("keeps the other lists to deleting and offers nothing without the edit permission", () => {
        expect(connectionBulkActions("destination", true).map((action) => action.id)).toEqual(["delete"]);
        expect(connectionBulkActions("notification", true).map((action) => action.id)).toEqual(["delete"]);
        expect(connectionBulkActions("database", false)).toEqual([]);
    });

    it("lists a connection in the confirmation with its name and type", () => {
        const [remove] = connectionBulkActions("destination", true);
        const row = { ...config("backups"), name: "Backups", adapterId: "local-filesystem" };

        expect(remove.itemName?.(row)).toBe("Backups");
        expect(remove.itemDetail?.(row)).toBe("Local Filesystem");
        expect(remove.itemDetail?.({ ...row, adapterId: "retired-adapter" })).toBe("retired-adapter");
    });
});

describe("deleteBlocker", () => {
    const used = (type: string, jobs: number, templates: number): AdapterConfig => ({
        ...config("a"),
        type,
        overview: { usedBy: { jobs, templates } } as AdapterConfig["overview"],
    });

    it("keeps a connection that a job still uses out of a delete", () => {
        expect(deleteBlocker(used("database", 2, 0))).toBe("Used by 2 jobs");
        expect(deleteBlocker(used("storage", 1, 0))).toBe("Used by 1 job");
    });

    it("lets a notification channel go when jobs only send their own notifications through it", () => {
        expect(deleteBlocker(used("notification", 3, 0))).toBeNull();
        expect(deleteBlocker(used("notification", 3, 1))).toBe("Used by 1 notification template");
    });

    it("leaves the decision to the server when the usage is not loaded", () => {
        expect(deleteBlocker(config("a"))).toBeNull();
    });

    it("is what the delete action checks for every selected connection", () => {
        const [remove] = connectionBulkActions("database", true);
        expect(remove.ineligible?.(used("database", 1, 0))).toBe("Used by 1 job");
        expect(remove.ineligible?.(used("database", 0, 0))).toBeNull();
    });
});
