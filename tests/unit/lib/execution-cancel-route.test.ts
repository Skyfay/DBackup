import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";
import type { CancelResult } from "@/services/history/run-cancel";

const mocks = vi.hoisted(() => ({
    ctx: vi.fn(),
    check: vi.fn(),
    cancel: vi.fn(),
    log: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: () => mocks.ctx(),
    checkPermissionWithContext: (...args: unknown[]) => mocks.check(...args),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.log, logFor: mocks.logFor } }));
vi.mock("@/services/history/run-cancel", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/history/run-cancel")>()),
    cancelRun: (...args: unknown[]) => mocks.cancel(...args),
}));

const { POST } = await import("@/app/api/executions/[id]/cancel/route");
const { subjectOf } = await import("@/services/history/run-cancel");

const CUSTOMER = { userId: "u1", authMethod: "session", tenantId: "acme" };
const PROVIDER = { userId: "u2", authMethod: "session", tenantId: "default" };

const cancel = (id: string) => POST(new NextRequest(`http://localhost/api/executions/${id}/cancel`, { method: "POST" }), { params: Promise.resolve({ id }) });

describe("POST /api/executions/[id]/cancel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.check.mockImplementation(() => undefined);
    });

    it("answers 403 to someone who may not run jobs, and cancels nothing", async () => {
        mocks.ctx.mockResolvedValue(CUSTOMER);
        mocks.check.mockImplementation(() => { throw new PermissionError("jobs:execute"); });

        const response = await cancel("r1");

        expect(response.status).toBe(403);
        expect(mocks.cancel).not.toHaveBeenCalled();
    });

    it("notes a customer's cancel of its backup of a shared database in its log and in the log of the server's tenant", async () => {
        mocks.ctx.mockResolvedValue(CUSTOMER);
        mocks.cancel.mockResolvedValue({
            run: { id: "follower", jobId: null, job: null, tenantId: "acme", subject: "shop" },
            leader: { id: "leader", jobId: "j1", job: { name: "Nightly" }, tenantId: "default", subject: null },
            message: "Cancellation signal sent",
        } satisfies CancelResult);

        const response = await cancel("follower");

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(CUSTOMER, "UPDATE", "BACKUP", { action: "cancel", name: "shop", executionId: "follower" }, undefined);
        expect(mocks.log).toHaveBeenCalledExactlyOnceWith("u1", "UPDATE", "JOB", { action: "cancel", name: "Nightly", database: "shop", executionId: "leader" }, "j1", { tenantId: "default" });
    });

    it("notes a provider's cancel of a customer's restore in the provider's own log alone", async () => {
        mocks.ctx.mockResolvedValue(PROVIDER);
        mocks.cancel.mockResolvedValue({
            run: { id: "provider-run", jobId: null, job: null, tenantId: "default", subject: "shop" },
            leader: { id: "customer-run", jobId: null, job: null, tenantId: "acme", subject: "shop" },
            message: "Cancellation signal sent",
        } satisfies CancelResult);

        await cancel("provider-run");

        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(PROVIDER, "UPDATE", "BACKUP", { action: "cancel", name: "shop", executionId: "provider-run" }, undefined);
        expect(mocks.log).not.toHaveBeenCalled();
    });

    it("notes a run of a job on the job, as before", async () => {
        mocks.ctx.mockResolvedValue(PROVIDER);
        mocks.cancel.mockResolvedValue({ run: { id: "r1", jobId: "j1", job: { name: "Nightly" }, tenantId: "default", subject: null }, leader: null, message: "Pending execution cancelled" } satisfies CancelResult);

        await cancel("r1");

        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(PROVIDER, "UPDATE", "JOB", { action: "cancel", name: "Nightly", executionId: "r1" }, "j1");
    });
});

describe("what a run without a job is of", () => {
    it("is the database of a shared one, else the backup a restore read, else where it restored to", () => {
        expect(subjectOf({ metadata: JSON.stringify({ backupOf: { database: "shop", provider: "MSP" } }), path: null })).toBe("shop");
        expect(subjectOf({ metadata: JSON.stringify({ restoreOf: { database: "billing", customer: "Acme" } }), path: "Nightly/a.tar" })).toBe("billing");
        expect(subjectOf({ metadata: JSON.stringify({ target: { name: "Shop DB" } }), path: "Nightly/backup_2026.tar" })).toBe("backup_2026.tar");
        expect(subjectOf({ metadata: JSON.stringify({ target: { name: "Shop DB" } }), path: null })).toBe("Shop DB");
        expect(subjectOf({ metadata: null, path: null })).toBeNull();
    });
});
