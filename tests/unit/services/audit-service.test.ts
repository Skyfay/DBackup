import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const request = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!request.headers) throw new Error("outside a request");
        return request.headers;
    },
}));

const { AuditService } = await import("@/services/audit-service");

describe("writing an entry of the audit log", () => {
    let service: InstanceType<typeof AuditService>;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AuditService();
        request.headers = null;
        prismaMock.auditLog.create.mockResolvedValue({} as never);
        prismaMock.user.findUnique.mockResolvedValue({ name: "Lena Graf" } as never);
        prismaMock.apiKey.findUnique.mockResolvedValue({ name: "CI pipeline" } as never);
    });

    it("keeps the name of the person, so it stays after they are deleted", async () => {
        await service.log("lena", "UPDATE", "JOB", { name: "Shop nightly" }, "job-1");

        expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ userId: "lena", actorName: "Lena Graf", apiKeyId: null, apiKeyName: null, resourceId: "job-1", details: JSON.stringify({ name: "Shop nightly" }) }),
        });
    });

    it("takes the address and the browser from the request it is written in", async () => {
        request.headers = new Headers({ "x-forwarded-for": "203.0.113.45, 10.0.0.1", "user-agent": "curl/8.5.0" });

        await service.log("lena", "DELETE", "BACKUP", { file: "a.tar" });

        expect(prismaMock.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ipAddress: "203.0.113.45", userAgent: "curl/8.5.0" }) });
    });

    it("writes without an address outside a request, like in a scheduled task", async () => {
        await service.log(null, "EXECUTE", "SYSTEM", { task: "Health check" });

        expect(prismaMock.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: null, actorName: null, ipAddress: null, userAgent: null }) });
    });

    it("names the API key a request came with, and its owner as the person", async () => {
        await service.logFor({ userId: "lena", authMethod: "apikey", apiKeyId: "key-1" }, "EXECUTE", "JOB", { name: "Shop nightly" }, "job-1");

        expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ userId: "lena", actorName: "Lena Graf", apiKeyId: "key-1", apiKeyName: "CI pipeline" }),
        });
    });

    it("names no key for a request from the browser", async () => {
        await service.logFor({ userId: "lena", authMethod: "session", apiKeyId: undefined }, "CREATE", "JOB", { name: "Shop nightly" });

        expect(prismaMock.apiKey.findUnique).not.toHaveBeenCalled();
        expect(prismaMock.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ apiKeyId: null }) });
    });

    it("never fails the action it records", async () => {
        prismaMock.auditLog.create.mockRejectedValue(new Error("database is locked"));

        await expect(service.log("lena", "DELETE", "JOB")).resolves.toBeUndefined();
    });
});

describe("cleaning the audit log", () => {
    it("deletes the entries older than the days it keeps", async () => {
        prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 4 } as never);

        const result = await new AuditService().cleanOldLogs(90);

        expect(result).toEqual({ count: 4 });
        const cutoff = prismaMock.auditLog.deleteMany.mock.calls[0][0]!.where!.createdAt as { lt: Date };
        expect(Date.now() - cutoff.lt.getTime()).toBeGreaterThan(89 * 86_400_000);
    });
});
