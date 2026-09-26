import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    known: [] as { id: string; name: string }[],
    saved: new Map<string, unknown>(),
    configs: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/prisma", () => ({ default: { adapterConfig: { findMany: vi.fn(async () => mocks.known) } } }));
vi.mock("@/services/storage/storage-alert-service", () => ({
    getAlertConfig: vi.fn(async (id: string) => mocks.configs.get(id)),
    saveAlertConfig: vi.fn(async (id: string, config: unknown) => {
        if (id === "broken") throw new Error("disk full");
        mocks.saved.set(id, config);
    }),
}));

const { applyAlertChanges, withAlertChanges } = await import("@/services/storage/storage-alert-changes");

const config = (overrides: Record<string, unknown> = {}) => ({
    usageSpikeEnabled: true, usageSpikeThresholdPercent: 20,
    storageLimitEnabled: false, storageLimitBytes: 10 * 1024 ** 3,
    missingBackupEnabled: true, missingBackupHours: 26,
    ...overrides,
});

describe("changing the alerts of several destinations", () => {
    beforeEach(() => {
        mocks.saved.clear();
        mocks.known = [{ id: "nas", name: "NAS Backups" }, { id: "r2", name: "Cloudflare R2" }, { id: "broken", name: "Broken" }];
        mocks.configs = new Map([["nas", config()], ["r2", config({ usageSpikeEnabled: false, missingBackupEnabled: false })], ["broken", config()]]);
    });

    it("changes only the alerts that were set, and an alert turned off keeps its value", () => {
        expect(withAlertChanges(config(), { missingBackup: { enabled: true, hours: 24 }, usageSpike: { enabled: false } })).toEqual(
            config({ missingBackupHours: 24, usageSpikeEnabled: false }),
        );
    });

    it("saves every destination on its own, so one that fails or is gone leaves the others saved", async () => {
        const result = await applyAlertChanges(["nas", "r2", "broken", "gone"], { storageLimit: { enabled: true, bytes: 25 * 1024 ** 3 } });

        expect(result.succeeded).toEqual(["nas", "r2"]);
        expect(result.failed).toEqual([
            { id: "broken", name: "Broken", error: "disk full" },
            { id: "gone", name: undefined, error: "This destination does not exist anymore" },
        ]);
        expect(mocks.saved.get("r2")).toEqual(config({ usageSpikeEnabled: false, missingBackupEnabled: false, storageLimitEnabled: true, storageLimitBytes: 25 * 1024 ** 3 }));
    });
});
