import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { credentialAudit, keyAudit } from "@/services/vault/vault-audit";

const row = (at: string, details: unknown, resourceId: string | null = null, name: string | null = "Manu", action?: string) => ({
    createdAt: new Date(at),
    resourceId,
    details: typeof details === "string" ? details : JSON.stringify(details),
    user: name ? { name } : null,
    ...(action ? { action } : {}),
});

describe("keyAudit", () => {
    beforeEach(() => vi.clearAllMocks());

    it("reads the kits with their keys and the reveals of each key, newest first", async () => {
        prismaMock.auditLog.findMany
            .mockResolvedValueOnce([
                row("2026-09-24T10:00:00Z", { action: "reveal_key" }, "production"),
                row("2026-09-20T10:00:00Z", { action: "recovery_kit_download", profileIds: ["production", "offsite"] }, null, "Anna"),
                row("2026-09-10T10:00:00Z", { action: "reveal_key" }, "production", null),
                row("2026-09-01T10:00:00Z", "not json", "production"),
            ] as never)
            .mockResolvedValueOnce([row("2026-03-14T10:00:00Z", { type: "EncryptionProfile" }, "production")] as never);

        const audit = await keyAudit(["production"]);

        expect(audit.kits).toEqual([{ at: "2026-09-20T10:00:00.000Z", by: "Anna", profileIds: ["production", "offsite"] }]);
        expect(audit.reveals.get("production")).toEqual({ last: { at: "2026-09-24T10:00:00.000Z", by: "Manu" }, count: 2 });
        expect(audit.created.get("production")).toEqual({ at: "2026-03-14T10:00:00.000Z", by: "Manu" });
    });

    it("finds who made a key among the entries of the Vault", async () => {
        prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);

        await keyAudit(["production"]);

        expect(prismaMock.auditLog.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: { action: "CREATE", resource: "VAULT", resourceId: { in: ["production"] } },
        }));
    });

    it("names who made a key by the name kept on the entry once that user is deleted", async () => {
        prismaMock.auditLog.findMany
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([{ ...row("2026-03-14T10:00:00Z", { type: "EncryptionProfile" }, "production", null), actorName: "Lena" }] as never);

        const audit = await keyAudit(["production"]);

        expect(audit.created.get("production")).toEqual({ at: "2026-03-14T10:00:00.000Z", by: "Lena" });
    });

    it("asks for no creator when there are no keys", async () => {
        prismaMock.auditLog.findMany.mockResolvedValueOnce([] as never);

        const audit = await keyAudit([]);

        expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(1);
        expect(audit.created.size).toBe(0);
    });
});

describe("credentialAudit", () => {
    beforeEach(() => vi.clearAllMocks());

    it("splits the entries of the profiles into reveals, the first creation and the last change", async () => {
        prismaMock.auditLog.findMany.mockResolvedValueOnce([
            row("2026-09-24T10:00:00Z", { action: "reveal" }, "skynas", "Manu", "EXPORT"),
            row("2026-09-02T10:00:00Z", { fields: ["name"] }, "skynas", "Anna", "UPDATE"),
            row("2026-08-02T10:00:00Z", { fields: ["data"] }, "skynas", "Manu", "UPDATE"),
            row("2026-06-26T10:00:00Z", { name: "SkyNas" }, "skynas", "Manu", "CREATE"),
        ] as never);

        const audit = await credentialAudit(["skynas"]);

        expect(audit.reveals.get("skynas")?.count).toBe(1);
        expect(audit.changed.get("skynas")).toEqual({ at: "2026-09-02T10:00:00.000Z", by: "Anna" });
        expect(audit.created.get("skynas")).toEqual({ at: "2026-06-26T10:00:00.000Z", by: "Manu" });
        expect(audit.revealRows).toEqual([{ at: "2026-09-24T10:00:00.000Z", by: "Manu", profileId: "skynas" }]);
    });

    it("keeps the name of whoever revealed a secret after that user is deleted", async () => {
        prismaMock.auditLog.findMany.mockResolvedValueOnce([
            { ...row("2026-09-24T10:00:00Z", { action: "reveal", name: "SkyNas" }, "skynas", null, "EXPORT"), actorName: "Anna" },
        ] as never);

        const audit = await credentialAudit(["skynas"]);

        expect(audit.revealRows).toEqual([{ at: "2026-09-24T10:00:00.000Z", by: "Anna", profileId: "skynas" }]);
    });

    it("reads nothing without profiles", async () => {
        await credentialAudit([]);
        expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
    });
});
