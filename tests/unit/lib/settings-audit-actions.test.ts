// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({
    audit: vi.fn(),
    retentionValues: vi.fn(),
    updateRetention: vi.fn(),
    certificateInfo: vi.fn(),
    uploadCertificate: vi.fn(),
    alertConfig: vi.fn(),
    saveAlertConfig: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: vi.fn(async () => ({ id: "admin" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/lib/rate-limit/server", () => ({ reloadRateLimits: vi.fn() }));
vi.mock("@/services/system/data-retention-service", () => ({
    getDataRetentionValues: (...args: unknown[]) => mocks.retentionValues(...args),
    updateDataRetentionSettings: (...args: unknown[]) => mocks.updateRetention(...args),
}));
vi.mock("@/services/system/certificate-service", () => ({
    getCertificateInfo: (...args: unknown[]) => mocks.certificateInfo(...args),
    uploadCertificate: (...args: unknown[]) => mocks.uploadCertificate(...args),
}));
vi.mock("@/services/storage/storage-alert-service", () => ({
    getAlertConfig: (...args: unknown[]) => mocks.alertConfig(...args),
    saveAlertConfig: (...args: unknown[]) => mocks.saveAlertConfig(...args),
}));

const { updateRateLimitSettings } = await import("@/app/actions/settings/rate-limit-settings");
const { saveDataRetentionAction } = await import("@/app/actions/settings/data-retention");
const { uploadCertificate } = await import("@/app/actions/settings/certificate");
const { updateStorageAlertSettings } = await import("@/app/actions/storage/storage-alerts");

const RATE_LIMITS = { auth: { points: 10, duration: 120 }, api: { points: 100, duration: 60 }, mutation: { points: 20, duration: 60 } };
const RETENTION = { executionLogs: 90, executionHistory: 0, auditLog: 90, notificationHistory: 90, storageUsage: 90, healthChecks: 2 };

describe("the audit entry of a settings change", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.$transaction.mockResolvedValue([] as never);
    });

    it("writes the rate limits that changed with their values before and after", async () => {
        prismaMock.systemSetting.findMany
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([{ key: "rateLimit.auth.points", value: "10" }, { key: "rateLimit.auth.duration", value: "120" }] as never);

        expect(await updateRateLimitSettings(RATE_LIMITS)).toEqual({ success: true });

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SYSTEM", {
            area: "Rate limits",
            changes: [
                { field: "Sign-ins", from: "5 requests", to: "10 requests" },
                { field: "Sign-ins window", from: "60 seconds", to: "120 seconds" },
            ],
        });
    });

    it("refuses a window under 10 seconds and names its field", async () => {
        const result = await updateRateLimitSettings({ ...RATE_LIMITS, api: { points: 100, duration: 5 } });

        expect(result).toEqual({ success: false, error: "A window is at least 10 seconds", field: "api" });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("writes nothing for a save that changed nothing", async () => {
        prismaMock.systemSetting.findMany.mockResolvedValue([] as never);

        await updateRateLimitSettings({ ...RATE_LIMITS, auth: { points: 5, duration: 60 } });

        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("writes a retention period in the words of the Data retention part", async () => {
        mocks.retentionValues.mockResolvedValueOnce(RETENTION).mockResolvedValueOnce({ ...RETENTION, auditLog: 365 });

        expect(await saveDataRetentionAction({ auditLog: 365 })).toEqual({ success: true });

        expect(mocks.updateRetention).toHaveBeenCalledWith({ auditLog: 365 });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SYSTEM", {
            area: "Data retention",
            changes: [{ field: "Audit log", from: "90 days", to: "1 year" }],
        });
    });

    it("writes what a new certificate says about itself and its private key only as changed", async () => {
        const certificate = (subject: string, fingerprint: string, validTo: string) => ({
            exists: true, subject, issuer: subject, validFrom: "", validTo, serialNumber: "01", fingerprint, isSelfSigned: false, daysRemaining: 300, isHttpsEnabled: true,
        });
        mocks.certificateInfo
            .mockReturnValueOnce(certificate("CN=DBackup", "AA:BB", "Sep 29 12:00:00 2026 GMT"))
            .mockReturnValueOnce(certificate("CN=backup.example.com", "CC:DD", "Sep 29 12:00:00 2027 GMT"));
        const form = new FormData();
        form.set("certificate", new File(["-----BEGIN CERTIFICATE-----\nPUBLIC\n-----END CERTIFICATE-----"], "tls.crt"));
        form.set("privateKey", new File(["-----BEGIN PRIVATE KEY-----\nTOPSECRETKEYMATERIAL\n-----END PRIVATE KEY-----"], "tls.key"));

        const result = await uploadCertificate(form);

        expect(result.success).toBe(true);
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SYSTEM", {
            area: "Certificate",
            changes: [
                { field: "Subject", from: "CN=DBackup", to: "CN=backup.example.com" },
                { field: "Issuer", from: "CN=DBackup", to: "CN=backup.example.com" },
                { field: "Valid until", from: "2026-09-29", to: "2027-09-29" },
                { field: "Fingerprint", from: "AA:BB", to: "CC:DD" },
                { field: "Private key", from: null, to: null, secret: true },
            ],
        });
        expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("TOPSECRETKEYMATERIAL");
    });

    it("names the destination whose alerts changed", async () => {
        mocks.alertConfig.mockResolvedValue({
            usageSpikeEnabled: false, usageSpikeThresholdPercent: 50, storageLimitEnabled: false, storageLimitBytes: 10737418240, missingBackupEnabled: false, missingBackupHours: 48,
        });
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ name: "Office NAS" } as never);

        await updateStorageAlertSettings("nas", {
            usageSpikeEnabled: true, usageSpikeThresholdPercent: 30, storageLimitEnabled: false, storageLimitBytes: 10737418240, missingBackupEnabled: false, missingBackupHours: 48,
        });

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "ADAPTER", {
            name: "Office NAS",
            area: "Storage alerts",
            changes: [
                { field: "Usage spike", from: "Off", to: "On" },
                { field: "Usage spike threshold", from: "50 %", to: "30 %" },
            ],
        }, "nas");
    });
});
