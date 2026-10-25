// @vitest-environment node
/**
 * A check of a backup against its checksum keeps its result in the `.meta.json` of the backup. It
 * belongs to one tenant, so All tenants checks none, and every check is in the audit log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    verifyFile: vi.fn(),
    startCopyVerification: vi.fn(),
    logFor: vi.fn(),
    findDestination: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => mocks.ctx,
    checkPermissionWithContext: (ctx: Ctx, permission: string) => {
        if (!(ctx.isPlatformAdmin && !ctx.allTenants) && !ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    tenantOf: (ctx: Ctx) => {
        if (!ctx.tenantId) throw new PermissionError("a tenant");
        return ctx.tenantId;
    },
}));
vi.mock("@/services/storage/verification-service", () => ({ verificationService: { verifyFile: (...args: unknown[]) => mocks.verifyFile(...args) } }));
vi.mock("@/services/storage/copy-verification", () => ({
    startCopyVerification: (...args: unknown[]) => mocks.startCopyVerification(...args),
    readCopyVerification: vi.fn(),
}));
vi.mock("@/services/sharing/destination-access", async () => {
    const { innerPath } = await import("@/lib/tenant/storage-view");
    return {
        // The path through the view the destination has, as the real one does.
        findDestinationPath: async (id: string, remotePath: string, tenantId?: string) => {
            const found = await mocks.findDestination(id, tenantId);
            innerPath(found.mode, remotePath);
            return found;
        },
    };
});
vi.mock("@/services/user/user-service", () => ({ userService: { nameOf: async () => "Lena Graf" } }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));
vi.mock("@/services/storage/backup-audit", () => ({
    backupAuditDetails: async (destinationId: string, file: string) => ({ file, destination: destinationId === "nas" ? "NAS" : "Offsite", job: "Shop" }),
}));

const verify = await import("@/app/api/storage/[id]/verify/route");
const verifyAsync = await import("@/app/api/storage/[id]/verify-async/route");
const verifyCopies = await import("@/app/api/storage/verify-copies/route");

const post = (body: unknown) => new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const params = { params: Promise.resolve({ id: "nas" }) };
const reader = (): Ctx => ({ userId: "lena", tenantId: "acme", allTenants: false, isPlatformAdmin: false, permissions: [PERMISSIONS.STORAGE.READ], authMethod: "session" });
const allTenants = (): Ctx => ({ userId: "root", tenantId: null, allTenants: true, isPlatformAdmin: true, permissions: [PERMISSIONS.STORAGE.READ], authMethod: "session" });

const FILE = "Shop/shop_2026-10-01.tar";

describe("checking a backup against its checksum", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyFile.mockResolvedValue({ status: "passed", verifiedAt: "2026-10-17T10:00:00.000Z" });
        mocks.startCopyVerification.mockResolvedValue({ executionId: "exec-1" });
        mocks.findDestination.mockImplementation(async (id: string) => ({ row: { id }, mode: { kind: "own" }, tenantId: "acme" }));
    });

    it("checks none in All tenants, since the result is written into a backup of one tenant", async () => {
        mocks.ctx = allTenants();

        expect((await verify.POST(post({ file: FILE }), params)).status).toBe(403);
        expect((await verifyAsync.POST(post({ file: FILE }), params)).status).toBe(403);
        expect((await verifyCopies.POST(post({ copies: [{ destinationId: "nas", file: FILE }] }))).status).toBe(403);

        expect(mocks.verifyFile).not.toHaveBeenCalled();
        expect(mocks.startCopyVerification).not.toHaveBeenCalled();
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("answers 403 to someone who may not see the backups", async () => {
        mocks.ctx = { ...reader(), permissions: [] };

        expect((await verify.POST(post({ file: FILE }), params)).status).toBe(403);
        expect((await verifyAsync.POST(post({ file: FILE }), params)).status).toBe(403);
        expect(mocks.verifyFile).not.toHaveBeenCalled();
    });

    it("checks one for whoever may see the backups in the tenant and notes who checked which backup", async () => {
        mocks.ctx = reader();

        const response = await verify.POST(post({ file: FILE }), params);

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "EXECUTE", "BACKUP", { action: "verify", file: FILE, destination: "NAS", job: "Shop", status: "passed" }, "nas");
    });

    it("notes a check that runs in History with its run", async () => {
        mocks.ctx = reader();

        expect((await verifyAsync.POST(post({ file: FILE }), params)).status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "EXECUTE", "BACKUP", { action: "verify", file: FILE, destination: "NAS", job: "Shop", executionId: "exec-1" }, "nas");
    });

    it("notes every copy a check of copies looks at", async () => {
        mocks.ctx = reader();

        const response = await verifyCopies.POST(post({ copies: [{ destinationId: "nas", file: FILE }, { destinationId: "offsite", file: FILE }] }));

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledTimes(2);
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "EXECUTE", "BACKUP", expect.objectContaining({ action: "verify", destination: "Offsite", executionId: "exec-1" }), "offsite");
    });

    describe("a backup outside the tenant's view of the destination", () => {
        const PROVIDER_PATH = "tenants/globex/Shop/shop_2026-10-01.tar";

        beforeEach(() => {
            mocks.ctx = reader();
            // The tenant shares the destination, so the folder of its customers is not its own.
            mocks.findDestination.mockImplementation(async (id: string) => ({ row: { id }, mode: { kind: "provider" }, tenantId: "acme" }));
        });

        it("checks none and notes none in the folder of the customers", async () => {
            expect((await verify.POST(post({ file: PROVIDER_PATH }), params)).status).toBe(400);
            expect((await verifyAsync.POST(post({ file: PROVIDER_PATH }), params)).status).toBe(400);
            expect((await verifyCopies.POST(post({ copies: [{ destinationId: "nas", file: FILE }, { destinationId: "offsite", file: PROVIDER_PATH }] }))).status).toBe(400);

            expect(mocks.verifyFile).not.toHaveBeenCalled();
            expect(mocks.startCopyVerification).not.toHaveBeenCalled();
            expect(mocks.logFor).not.toHaveBeenCalled();
        });

        it("checks none on a destination the tenant does not use", async () => {
            const { NotFoundError } = await import("@/lib/logging/errors");
            mocks.findDestination.mockRejectedValue(new NotFoundError("Storage adapter", "nas"));

            expect((await verify.POST(post({ file: FILE }), params)).status).toBe(404);
            expect((await verifyAsync.POST(post({ file: FILE }), params)).status).toBe(404);
            expect((await verifyCopies.POST(post({ copies: [{ destinationId: "nas", file: FILE }] }))).status).toBe(404);
            expect(mocks.logFor).not.toHaveBeenCalled();
        });
    });
});
