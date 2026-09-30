// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    caller: vi.fn(),
    importConfig: vi.fn(),
    restoreFromStorage: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: vi.fn(async () => mocks.caller()) }));
vi.mock("@/services/config/config-service", () => ({
    ConfigService: class {
        import = mocks.importConfig;
        restoreFromStorage = mocks.restoreFromStorage;
    },
}));
vi.mock("@/lib/runner/config-runner", () => ({ runConfigBackup: vi.fn() }));
vi.mock("@/services/backup/encryption-service", () => ({ getProfileMasterKey: vi.fn() }));
vi.mock("@/services/adapters/adapter-audit", () => ({ connectionName: vi.fn(async () => "NAS") }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));

// Restore from a file is the route /api/settings/config-backup/restore, see config-restore-route.test.ts.
const { restoreFromStorageAction } = await import("@/app/actions/backup/config-management");

const SUPER_ADMIN = { id: "root", group: { name: "SuperAdmin" } };
const SETTINGS_ADMIN = { id: "lena", group: { name: "Settings" } };

describe("restoring the configuration of DBackup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.restoreFromStorage.mockResolvedValue("exec-1");
    });

    it("is for a SuperAdmin only, since a restore writes users and groups and could make anyone a SuperAdmin", async () => {
        mocks.caller.mockReturnValue(SETTINGS_ADMIN);
        const refused = { success: false, error: "Only a SuperAdmin restores a configuration backup." };

        expect(await restoreFromStorageAction("dest-1", "config_backup.json.gz")).toEqual(refused);
        expect(mocks.importConfig).not.toHaveBeenCalled();
        expect(mocks.restoreFromStorage).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("starts a restore from a destination for a SuperAdmin and writes it to the audit log", async () => {
        mocks.caller.mockReturnValue(SUPER_ADMIN);

        expect(await restoreFromStorageAction("dest-1", "config_backup.json.gz")).toEqual({ success: true, executionId: "exec-1" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "RESTORE", "SYSTEM", { action: "config_restore", file: "config_backup.json.gz", destination: "NAS" });
    });

    it("needs the right to change the settings before anything else", async () => {
        mocks.caller.mockImplementation(() => {
            throw new PermissionError("settings:write");
        });

        await expect(restoreFromStorageAction("dest-1", "config_backup.json.gz")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.restoreFromStorage).not.toHaveBeenCalled();
    });
});
