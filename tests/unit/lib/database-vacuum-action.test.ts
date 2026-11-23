/**
 * Compacting the database of DBackup under Settings writes an entry into the log of the platform
 * that names what it ran on, like every entry names its record.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ audit: vi.fn(), vacuum: vi.fn() }));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: vi.fn(async () => ({ id: "manu" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/system/database-service", () => ({ vacuumDatabase: mocks.vacuum }));
vi.mock("@/services/system/settings-save", () => ({ PLATFORM_LOG: { tenantId: "default" } }));

const { vacuumDatabaseAction } = await import("@/app/actions/settings/database");

describe("compacting the database of DBackup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.vacuum.mockResolvedValue({ beforeBytes: 2048, afterBytes: 1024, durationMs: 40 });
    });

    it("names the database in the log of the platform", async () => {
        expect(await vacuumDatabaseAction()).toMatchObject({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith(
            "manu",
            "EXECUTE",
            "SYSTEM",
            { name: "Database of DBackup", action: "database_vacuum", beforeBytes: 2048, afterBytes: 1024, durationMs: 40 },
            undefined,
            { tenantId: "default" },
        );
    });
});
