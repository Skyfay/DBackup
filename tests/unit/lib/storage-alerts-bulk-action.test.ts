import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ allowed: true, apply: vi.fn() }));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.allowed) throw new PermissionError(permission);
    }),
}));
vi.mock("@/services/storage/storage-alert-service", () => ({ saveAlertConfig: vi.fn() }));
vi.mock("@/services/storage/storage-alert-changes", () => ({ applyAlertChanges: mocks.apply }));

const { updateStorageAlertsOfMany } = await import("@/app/actions/storage/storage-alerts");

describe("changing the alerts of several destinations in one step", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.allowed = true;
        mocks.apply.mockResolvedValue({ succeeded: ["nas", "r2"], failed: [] });
    });

    it("hands the set alerts on and answers with what each destination did", async () => {
        const result = await updateStorageAlertsOfMany(["nas", "r2"], { missingBackup: { enabled: true, hours: 24 }, usageSpike: { enabled: false } });

        expect(result).toEqual({ success: true, data: { succeeded: ["nas", "r2"], failed: [] } });
        expect(mocks.apply).toHaveBeenCalledWith(["nas", "r2"], { missingBackup: { enabled: true, hours: 24 }, usageSpike: { enabled: false } });
    });

    it("turns down an alert switched on without its value, and a request that changes nothing", async () => {
        expect(await updateStorageAlertsOfMany(["nas"], { storageLimit: { enabled: true } })).toEqual({ success: false, error: "Turning the storage limit alert on needs a size" });
        expect(await updateStorageAlertsOfMany(["nas"], {})).toEqual({ success: false, error: "Nothing to change" });
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it("needs the permission to change settings", async () => {
        mocks.allowed = false;

        await expect(updateStorageAlertsOfMany(["nas"], { usageSpike: { enabled: false } })).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.apply).not.toHaveBeenCalled();
    });
});
