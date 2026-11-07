import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    permissions: [] as string[],
    start: vi.fn(),
    read: vi.fn(),
    configBackups: new Set<string>(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn(async () => ({ name: "Manu" })) } } }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "u1", permissions: mocks.permissions, isPlatformAdmin: false, tenantId: "default" }),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        if (!mocks.permissions.includes(permission)) throw new PermissionError(permission);
    },
    tenantOf: (ctx: { tenantId: string }) => ctx.tenantId,
}));
vi.mock("@/services/storage/copy-verification", () => ({ startCopyVerification: mocks.start, readCopyVerification: mocks.read }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: vi.fn() } }));
vi.mock("@/services/sharing/destination-access", () => ({ findDestinationPath: vi.fn(async (id: string) => ({ row: { id }, mode: { kind: "own" }, tenantId: "default" })) }));
// The real guard, with a sidecar or path that marks the copy as a configuration backup.
vi.mock("@/services/storage/config-backup-access", () => ({
    isConfigBackupFile: async (storageId: string, file: string) => mocks.configBackups.has(`${storageId}:${file}`),
}));
vi.mock("@/services/storage/backup-audit", () => ({ backupAuditDetails: async (_destinationId: string, file: string) => ({ file }) }));

const { POST, GET } = await import("@/app/api/storage/verify-copies/route");

const start = (body: unknown) => POST(new NextRequest("http://dbackup.test/api/storage/verify-copies", { method: "POST", body: JSON.stringify(body) }));
const read = (id: string) => GET(new NextRequest(`http://dbackup.test/api/storage/verify-copies?executionId=${id}`));
const COPIES = [{ destinationId: "nas", file: "UI Test/UI_Test.tar" }, { destinationId: "sftp", file: "UI Test/UI_Test.tar" }];

describe("checking the copies of a backup over the API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.permissions = ["storage:read"];
        mocks.start.mockResolvedValue({ executionId: "exec-1" });
        mocks.configBackups.clear();
    });

    it("checks no copy of a configuration backup for anyone but a platform admin with a session", async () => {
        mocks.configBackups.add("sftp:UI Test/UI_Test.tar");

        const response = await start({ copies: COPIES });

        expect(response.status).toBe(403);
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it("starts one run for every copy named, in the name of the user", async () => {
        const response = await start({ copies: COPIES });

        expect(await response.json()).toEqual({ success: true, data: { executionId: "exec-1" } });
        expect(mocks.start).toHaveBeenCalledWith(COPIES, "Manu");
    });

    it("turns down a path that leaves the destination and a call without the read permission", async () => {
        expect((await start({ copies: [{ destinationId: "nas", file: "../etc/passwd" }] })).status).toBe(400);

        mocks.permissions = [];
        expect((await start({ copies: COPIES })).status).toBe(403);
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it("hands back where a check stands, and 404 for a run that is none", async () => {
        mocks.read.mockResolvedValueOnce({ executionId: "exec-1", status: "Running", progress: 40, copies: [] });
        expect(await (await read("exec-1")).json()).toEqual({ success: true, data: { executionId: "exec-1", status: "Running", progress: 40, copies: [] } });

        mocks.read.mockResolvedValueOnce(null);
        expect((await read("exec-9")).status).toBe(404);
    });
});
