// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";

const mocks = vi.hoisted(() => ({
    viewer: { id: "admin", tenantId: "acme" as string | null, allTenants: false },
    checkPermission: vi.fn(),
    getAlertConfig: vi.fn(),
    saveAlertConfig: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        mocks.checkPermission(permission);
        return mocks.viewer;
    }),
}));
vi.mock("@/services/storage/storage-alert-service", () => ({
    getAlertConfig: (...args: unknown[]) => mocks.getAlertConfig(...args),
    saveAlertConfig: (...args: unknown[]) => mocks.saveAlertConfig(...args),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));

const { updateStorageAlertSettings } = await import("@/app/actions/storage/storage-alerts");

const ALERTS = {
    usageSpikeEnabled: false, usageSpikeThresholdPercent: 50, storageLimitEnabled: false, storageLimitBytes: 10737418240, missingBackupEnabled: false, missingBackupHours: 48,
};
const SPIKE_ON = { ...ALERTS, usageSpikeEnabled: true };

describe("the alerts of one destination", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = { id: "admin", tenantId: "acme", allTenants: false };
        mocks.getAlertConfig.mockResolvedValue(ALERTS);
    });

    it("change with the right to change destinations, which the admin of a customer holds", async () => {
        prismaMock.adapterConfig.findFirst.mockResolvedValue({ name: "Office NAS" } as never);

        expect(await updateStorageAlertSettings("nas", SPIKE_ON)).toEqual({ success: true });

        expect(mocks.checkPermission).toHaveBeenCalledWith(PERMISSIONS.DESTINATIONS.WRITE);
        expect(mocks.saveAlertConfig).toHaveBeenCalledWith("nas", SPIKE_ON);
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "ADAPTER", expect.objectContaining({ name: "Office NAS" }), "nas");
    });

    it("only belong to a destination of the open tenant, so an id of another tenant saves nothing", async () => {
        // The filtered client finds no row of another tenant.
        prismaMock.adapterConfig.findFirst.mockResolvedValue(null);

        expect(await updateStorageAlertSettings("their-nas", SPIKE_ON)).toEqual({ success: false, error: "This destination does not exist anymore" });

        expect(prismaMock.adapterConfig.findFirst).toHaveBeenCalledWith({ where: { id: "their-nas", type: "storage", storageRole: STORAGE_ROLES.DESTINATION }, select: { name: true } });
        expect(mocks.saveAlertConfig).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("change nowhere in All tenants or without a tenant", async () => {
        for (const viewer of [{ id: "admin", tenantId: null, allTenants: true }, { id: "admin", tenantId: null, allTenants: false }]) {
            mocks.viewer = viewer;

            expect(await updateStorageAlertSettings("nas", SPIKE_ON)).toEqual({ success: false, error: "Open the tenant of the destination to change its alerts." });
        }

        expect(prismaMock.adapterConfig.findFirst).not.toHaveBeenCalled();
        expect(mocks.saveAlertConfig).not.toHaveBeenCalled();
    });

    it("are refused for a destination without an id", async () => {
        expect(await updateStorageAlertSettings("", SPIKE_ON)).toEqual({ success: false, error: "Unknown destination" });
        expect(mocks.saveAlertConfig).not.toHaveBeenCalled();
    });
});
