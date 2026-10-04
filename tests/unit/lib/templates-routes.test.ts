import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    checkPermission: vi.fn(),
    getSession: vi.fn(),
    getTemplatesModel: vi.fn(),
    getRetentionTargets: vi.fn(),
    deleteSchedulePreset: vi.fn(),
    deleteSchedulePresetMany: vi.fn(),
    templateNames: vi.fn(),
    refresh: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkPermission: (...args: unknown[]) => mocks.checkPermission(...args),
    getUserPermissions: vi.fn(async () => []),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: (...args: unknown[]) => mocks.getSession(...args) } } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/services/templates/template-audit", () => ({ templateNames: (...args: unknown[]) => mocks.templateNames(...args) }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: (...args: unknown[]) => mocks.refresh(...args) } }));
vi.mock("@/services/templates/templates-model", () => ({ getTemplatesModel: (...args: unknown[]) => mocks.getTemplatesModel(...args) }));
vi.mock("@/services/templates/retention-targets", () => ({ getRetentionTargets: (...args: unknown[]) => mocks.getRetentionTargets(...args) }));
vi.mock("@/services/templates/schedule-preset-service", () => ({
    deleteSchedulePreset: (...args: unknown[]) => mocks.deleteSchedulePreset(...args),
    deleteSchedulePresetMany: (...args: unknown[]) => mocks.deleteSchedulePresetMany(...args),
}));

import { GET as getTemplates } from "@/app/api/templates/route";
import { getRetentionPolicyTargets } from "@/app/actions/templates-retention";
import { deleteSchedulePreset } from "@/app/actions/templates";
import { bulkDeleteSchedulePresets } from "@/app/actions/templates-bulk";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isSuperAdmin: false });

describe("GET /api/templates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTemplatesModel.mockResolvedValue({ retention: [] });
    });

    it("turns away a request without a session", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await getTemplates()).status).toBe(401);
    });

    it("needs the right to read templates", async () => {
        signedIn(PERMISSIONS.JOBS.READ);
        expect((await getTemplates()).status).toBe(403);
        expect(mocks.getTemplatesModel).not.toHaveBeenCalled();
    });

    it("answers with every template and what uses it", async () => {
        signedIn(PERMISSIONS.TEMPLATES.READ);
        const response = await getTemplates();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { retention: [] } });
    });
});

describe("the destinations a retention change reaches", () => {
    beforeEach(() => vi.clearAllMocks());

    it("asks for the right to read templates before it looks at a backup", async () => {
        mocks.checkPermission.mockRejectedValueOnce(new PermissionError(PERMISSIONS.TEMPLATES.READ));

        await expect(getRetentionPolicyTargets({ policyId: "gfs" })).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.getRetentionTargets).not.toHaveBeenCalled();
    });

    it("hands the scope on and refuses anything else", async () => {
        mocks.getRetentionTargets.mockResolvedValue({ timezone: "UTC", targets: [], unlisted: [] });

        expect(await getRetentionPolicyTargets({ followers: true })).toEqual({ success: true, data: { timezone: "UTC", targets: [], unlisted: [] } });
        expect(mocks.checkPermission).toHaveBeenCalledWith(PERMISSIONS.TEMPLATES.READ);
        expect(mocks.getRetentionTargets).toHaveBeenCalledWith({ followers: true });
        expect(await getRetentionPolicyTargets({ policyId: "" })).toEqual({ success: false, error: "Invalid request" });
    });
});

describe("deleting schedule presets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
        mocks.refresh.mockResolvedValue(undefined);
    });

    it("tells the scheduler at once, so the jobs that followed the preset run on their own copy", async () => {
        mocks.deleteSchedulePreset.mockResolvedValue({ name: "Daily at 3 AM" });

        expect(await deleteSchedulePreset("3am")).toEqual({ success: true });
        expect(mocks.checkPermission).toHaveBeenCalledWith(PERMISSIONS.TEMPLATES.WRITE);
        expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });

    it("names the deleted preset in the audit log", async () => {
        mocks.deleteSchedulePreset.mockResolvedValue({ name: "Daily at 3 AM" });

        await deleteSchedulePreset("3am");

        expect(mocks.audit).toHaveBeenCalledWith("u1", "DELETE", "TEMPLATE", { type: "SchedulePreset", name: "Daily at 3 AM" }, "3am");
    });

    it("tells the scheduler once after a bulk delete that removed a preset", async () => {
        mocks.templateNames.mockResolvedValue(new Map([["3am", "Daily at 3 AM"], ["hourly", "Hourly"]]));
        mocks.deleteSchedulePresetMany.mockResolvedValue({ succeeded: ["3am", "hourly"], failed: [] });

        await bulkDeleteSchedulePresets(["3am", "hourly"]);

        expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });

    it("names the presets a bulk delete removed, read before they were gone", async () => {
        mocks.templateNames.mockResolvedValue(new Map([["3am", "Daily at 3 AM"], ["hourly", "Hourly"]]));
        mocks.deleteSchedulePresetMany.mockResolvedValue({ succeeded: ["3am"], failed: [{ id: "hourly", name: "Hourly", error: "In use" }] });

        await bulkDeleteSchedulePresets(["3am", "hourly"]);

        expect(mocks.templateNames).toHaveBeenCalledWith("SchedulePreset", ["3am", "hourly"]);
        expect(mocks.audit).toHaveBeenCalledWith("u1", "DELETE", "TEMPLATE", {
            type: "SchedulePreset",
            bulk: true,
            requested: 2,
            succeeded: 1,
            failed: 1,
            names: ["Daily at 3 AM"],
        });
    });

    it("leaves the scheduler alone when nothing was deleted", async () => {
        mocks.templateNames.mockResolvedValue(new Map([["3am", "Daily at 3 AM"]]));
        mocks.deleteSchedulePresetMany.mockResolvedValue({ succeeded: [], failed: [{ id: "3am", name: "Daily at 3 AM", error: "Not found" }] });

        await bulkDeleteSchedulePresets(["3am"]);

        expect(mocks.refresh).not.toHaveBeenCalled();
    });
});
