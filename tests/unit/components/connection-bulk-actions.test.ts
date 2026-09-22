import { describe, it, expect } from "vitest";
import { connectionBulkActions } from "@/components/adapter/connection-bulk-actions";
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
});
