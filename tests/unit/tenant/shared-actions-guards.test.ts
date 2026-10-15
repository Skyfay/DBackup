/**
 * The guards of the actions around shared databases: moving a database and switching backups on
 * demand need the right to share databases, a backup on demand needs Run now of a job in the
 * customer's tenant, and each refused one touches no service. A backup on demand lands in the audit
 * log of the customer and of the tenant of the server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { SEE_SHARED_DATABASES_PERMISSION, SHARE_DATABASES_PERMISSION } from "@/lib/tenant/sharing";

const mocks = vi.hoisted(() => ({
    granted: new Set<string>(),
    checked: [] as string[],
    viewer: { id: "u-lena", name: "Lena Graf", tenantId: "acme" as string | null },
    move: vi.fn(),
    targets: vi.fn(),
    setOnDemand: vi.fn(),
    setRuleOnDemand: vi.fn(),
    request: vi.fn(),
    run: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    // Any one of a list passes, like the real check.
    checkPermission: vi.fn(async (permission: string | string[]) => {
        const wanted = Array.isArray(permission) ? permission : [permission];
        mocks.checked.push(wanted.join(" or "));
        if (!wanted.some((entry) => mocks.granted.has(entry))) throw new PermissionError(wanted.join(" or "));
        return mocks.viewer;
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/tenant/database-assignments", () => ({
    databaseAssignmentService: { setOnDemand: mocks.setOnDemand, setRuleOnDemand: mocks.setRuleOnDemand },
}));
vi.mock("@/services/tenant/database-moves", () => ({ moveDatabase: mocks.move, moveTargets: mocks.targets }));
vi.mock("@/services/tenant/shared-servers", () => ({ customersOfServer: vi.fn() }));
vi.mock("@/services/tenant/shared-databases", () => ({ sharedOverview: vi.fn(), prepareSharedDownload: vi.fn(), restoreSharedBackup: vi.fn() }));
vi.mock("@/services/tenant/shared-on-demand", () => ({ requestSharedBackup: mocks.request, sharedBackupRun: mocks.run }));

const { moveSharedDatabase, getMoveTargets, setDatabaseOnDemand, setRuleOnDemand, getSourceAssignments, assignDatabases } = await import("@/app/actions/tenant/database-assignments");
const { backUpSharedDatabase, getSharedBackupRun } = await import("@/app/actions/tenant/shared-databases");

beforeEach(() => {
    vi.clearAllMocks();
    mocks.granted = new Set();
    mocks.checked = [];
    mocks.viewer = { id: "u-lena", name: "Lena Graf", tenantId: "acme" };
});

describe("who shares the databases of a shared server", () => {
    it("is whoever holds Share databases, a right on the platform that no group of a tenant gives", () => {
        expect(SHARE_DATABASES_PERMISSION).toBe(PERMISSIONS.PLATFORM.SHARING_WRITE);
        expect(SEE_SHARED_DATABASES_PERMISSION).toBe(PERMISSIONS.PLATFORM.SHARING_READ);
    });

    it("no longer lets a group of the home tenant that changes connections give a database away", async () => {
        mocks.granted.add(PERMISSIONS.SOURCES.VIEW);
        mocks.granted.add(PERMISSIONS.SOURCES.WRITE);

        await expect(assignDatabases("old", [{ databaseName: "shop", tenantId: "acme" }])).rejects.toBeInstanceOf(PermissionError);
        await expect(moveSharedDatabase("old", { databaseName: "shop", toSourceId: "new" })).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.move).not.toHaveBeenCalled();
    });

    it("shows who holds which database only to whoever may see the shared databases", async () => {
        mocks.granted.add(PERMISSIONS.SOURCES.VIEW);
        await expect(getSourceAssignments("old")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.checked).toEqual([`${SEE_SHARED_DATABASES_PERMISSION} or ${SHARE_DATABASES_PERMISSION}`]);
    });
});

describe("what the tenant of a shared server changes", () => {
    it("moves a database only with the right to share databases", async () => {
        await expect(moveSharedDatabase("old", { databaseName: "shop", toSourceId: "new" })).rejects.toBeInstanceOf(PermissionError);
        await expect(getMoveTargets("old")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.checked).toEqual([SHARE_DATABASES_PERMISSION, SHARE_DATABASES_PERMISSION]);
        expect(mocks.move).not.toHaveBeenCalled();
        expect(mocks.targets).not.toHaveBeenCalled();
    });

    it("switches backups on demand only with the right to share databases", async () => {
        await expect(setDatabaseOnDemand("old", "shop", 3)).rejects.toBeInstanceOf(PermissionError);
        await expect(setRuleOnDemand("old", "rule-1", null)).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.setOnDemand).not.toHaveBeenCalled();
        expect(mocks.setRuleOnDemand).not.toHaveBeenCalled();
    });

    it("refuses a number of backups a day out of range before the service sees it", async () => {
        mocks.granted.add(SHARE_DATABASES_PERMISSION);
        expect(await setDatabaseOnDemand("old", "shop", 25)).toEqual(expect.objectContaining({ success: false }));
        expect(await setDatabaseOnDemand("old", "shop", 0)).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.setOnDemand).not.toHaveBeenCalled();
    });

    it("keeps the move in the audit log of the tenant of the server", async () => {
        mocks.granted.add(SHARE_DATABASES_PERMISSION);
        mocks.move.mockResolvedValue({ tenantName: "Acme", toServerName: "New MySQL", toDatabase: "shop2" });
        expect(await moveSharedDatabase("old", { databaseName: "shop", toSourceId: "new", toDatabase: "shop2" })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.move).toHaveBeenCalledWith("old", { databaseName: "shop", toSourceId: "new", toDatabase: "shop2" }, "u-lena");
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "UPDATE", "ADAPTER", expect.objectContaining({ change: "Database moved", to: "New MySQL", tenant: "Acme" }), "old");
    });
});

describe("a backup a customer starts on demand", () => {
    it("needs Run now of a job in the customer's tenant", async () => {
        await expect(backUpSharedDatabase({ sourceId: "new", databaseName: "shop2" })).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.checked).toEqual([PERMISSIONS.JOBS.EXECUTE]);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it("starts nothing in All tenants, which has no tenant", async () => {
        mocks.granted.add(PERMISSIONS.JOBS.EXECUTE);
        mocks.viewer = { ...mocks.viewer, tenantId: null };
        expect(await backUpSharedDatabase({ sourceId: "new", databaseName: "shop2" })).toEqual({ success: false, error: "Invalid request" });
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it("writes into the audit log of the customer and of the tenant of the server", async () => {
        mocks.granted.add(PERMISSIONS.JOBS.EXECUTE);
        mocks.request.mockResolvedValue({ requestId: "req-1", executionId: "run-1", databaseName: "shop2", jobId: "job-1", jobName: "Nightly", serverTenantId: "default", customerName: "Acme" });
        expect(await backUpSharedDatabase({ sourceId: "new", databaseName: "shop2" })).toEqual({ success: true, data: { requestId: "req-1" } });
        expect(mocks.request).toHaveBeenCalledWith("acme", { id: "u-lena", name: "Lena Graf" }, { sourceId: "new", databaseName: "shop2" });
        // The customer's entry names its database, never the run or the job of the server.
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "EXECUTE", "BACKUP", { action: "backup_on_demand", shared: true, name: "shop2", databases: ["shop2"] });
        expect(mocks.audit).toHaveBeenCalledWith("u-lena", "EXECUTE", "JOB", expect.objectContaining({ action: "backup_on_demand", name: "Nightly", tenant: "Acme", executionId: "run-1" }), "job-1", { tenantId: "default" });
    });

    it("hands a refusal of the service on in its own words", async () => {
        mocks.granted.add(PERMISSIONS.JOBS.EXECUTE);
        mocks.request.mockRejectedValue(new ValidationError("A backup of the server of shop2 runs right now. Try again once it is done."));
        expect(await backUpSharedDatabase({ sourceId: "new", databaseName: "shop2" })).toEqual({ success: false, error: "A backup of the server of shop2 runs right now. Try again once it is done." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("tells its state only to a viewer who may see the backups", async () => {
        await expect(getSharedBackupRun("req-1")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.checked).toEqual([PERMISSIONS.STORAGE.READ]);
        expect(mocks.run).not.toHaveBeenCalled();
    });
});
