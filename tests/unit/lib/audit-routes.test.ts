import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    listAudit: vi.fn(),
    getAuditFacets: vi.fn(),
    getAuditWhoOptions: vi.fn(),
    getAuditStats: vi.fn(),
    getAuditEntryDetails: vi.fn(),
    getAuditTimeline: vi.fn(),
    auditCsv: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The real check, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/dashboard/cache", () => ({ cached: (_key: string, _ttl: number, load: () => unknown) => load() }));
vi.mock("@/services/audit/audit-list-service", () => ({
    listAudit: (...args: unknown[]) => mocks.listAudit(...args),
    getAuditFacets: (...args: unknown[]) => mocks.getAuditFacets(...args),
    getAuditWhoOptions: (...args: unknown[]) => mocks.getAuditWhoOptions(...args),
    getAuditStats: (...args: unknown[]) => mocks.getAuditStats(...args),
}));
vi.mock("@/services/audit/audit-details", () => ({ getAuditEntryDetails: (...args: unknown[]) => mocks.getAuditEntryDetails(...args) }));
vi.mock("@/services/audit/audit-timeline", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/audit/audit-timeline")>()),
    getAuditTimeline: (...args: unknown[]) => mocks.getAuditTimeline(...args),
}));
vi.mock("@/services/audit/audit-export", () => ({ auditCsv: (...args: unknown[]) => mocks.auditCsv(...args) }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));

import { GET as getList } from "@/app/api/audit/route";
import { GET as getEntry } from "@/app/api/audit/[id]/route";
import { GET as getTimeline } from "@/app/api/audit/timeline/route";
import { GET as getExport } from "@/app/api/audit/export/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "manu", permissions, isSuperAdmin: false, authMethod: "session" });
const request = (path: string) => new NextRequest(`http://localhost${path}`);

describe("the routes of the audit log", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listAudit.mockResolvedValue({ rows: [], total: 0 });
        mocks.getAuditFacets.mockResolvedValue({ who: {}, area: {}, action: {}, quick: { all: 0, changes: 0, signins: 0, sensitive: 0 } });
        mocks.getAuditWhoOptions.mockResolvedValue([]);
        mocks.getAuditStats.mockResolvedValue({ entries: 0 });
        mocks.getAuditTimeline.mockResolvedValue({ from: "2026-09-01", to: "2026-09-29", rows: [] });
        mocks.auditCsv.mockResolvedValue({ csv: "Time (UTC)\r\n", count: 0 });
    });

    it("turn away a request without a session or a key", async () => {
        mocks.getAuthContext.mockResolvedValue(null);

        expect((await getList(request("/api/audit"))).status).toBe(401);
        expect((await getExport(request("/api/audit/export"))).status).toBe(401);
        expect(mocks.listAudit).not.toHaveBeenCalled();
    });

    it("need the right to see the audit log before they load anything", async () => {
        signedIn(PERMISSIONS.USERS.READ);

        expect((await getList(request("/api/audit"))).status).toBe(403);
        expect((await getEntry(request("/api/audit/a1"), { params: Promise.resolve({ id: "a1" }) })).status).toBe(403);
        expect((await getTimeline(request("/api/audit/timeline?start=2026-09-01&end=2026-09-29"))).status).toBe(403);
        expect((await getExport(request("/api/audit/export"))).status).toBe(403);
        expect(mocks.listAudit).not.toHaveBeenCalled();
        expect(mocks.getAuditEntryDetails).not.toHaveBeenCalled();
        expect(mocks.getAuditTimeline).not.toHaveBeenCalled();
        expect(mocks.auditCsv).not.toHaveBeenCalled();
    });

    it("answer one page with its filters, and refuse a filter it does not know", async () => {
        signedIn(PERMISSIONS.AUDIT.READ);

        const response = await getList(request("/api/audit?page=2&pageSize=10&area=jobs&who=user:lena&quick=sensitive"));
        expect(response.status).toBe(200);
        expect(mocks.listAudit).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 10, areas: ["jobs"], who: ["user:lena"], quick: "sensitive", period: "30d" }));

        expect((await getList(request("/api/audit?area=nowhere"))).status).toBe(400);
    });

    it("answer 404 for an entry the log no longer keeps", async () => {
        signedIn(PERMISSIONS.AUDIT.READ);
        mocks.getAuditEntryDetails.mockResolvedValue(null);

        expect((await getEntry(request("/api/audit/gone"), { params: Promise.resolve({ id: "gone" }) })).status).toBe(404);
    });

    it("cut the timeline at a range of days it can draw", async () => {
        signedIn(PERMISSIONS.AUDIT.READ);

        expect((await getTimeline(request("/api/audit/timeline?start=2026-09-01&end=2026-09-29&tz=Europe/Zurich"))).status).toBe(200);
        expect(mocks.getAuditTimeline).toHaveBeenCalledWith("2026-09-01", "2026-09-29", "Europe/Zurich", expect.any(Object));
        expect((await getTimeline(request("/api/audit/timeline?start=2025-01-01&end=2026-09-29"))).status).toBe(400);
    });

    it("write an export of the log to the log itself, with the filters it used", async () => {
        signedIn(PERMISSIONS.AUDIT.READ);
        mocks.auditCsv.mockResolvedValue({ csv: "a\r\n", count: 12 });

        const response = await getExport(request("/api/audit/export?period=7d&quick=signins"));

        expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
        expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="dbackup-audit-log-\d{4}-\d{2}-\d{2}\.csv"$/);
        expect(mocks.logFor).toHaveBeenCalledWith(expect.objectContaining({ userId: "manu" }), "EXPORT", "SYSTEM", { action: "audit_export", count: 12, filter: "period=7d&quick=signins" });
    });
});
