import { describe, it, expect } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { updateAdapterFlags } from "@/services/adapters/adapter-service";

const adapter = (id: string, type: string, metadata: Record<string, unknown> | null = null, storageRole: string | null = null) => ({
    id,
    name: `conn-${id}`,
    type,
    storageRole,
    metadata: metadata ? JSON.stringify(metadata) : null,
});

describe("updateAdapterFlags", () => {
    it("switches the setting and keeps the rest of the metadata", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([adapter("pg", "database", { engineVersion: "16.4" })] as never);

        const result = await updateAdapterFlags(["pg"], { healthNotificationsDisabled: true });

        expect(result.succeeded).toEqual(["pg"]);
        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith({
            where: { id: "pg" },
            data: { metadata: JSON.stringify({ engineVersion: "16.4", healthNotificationsDisabled: true }) },
        });
    });

    it("refuses to leave a destination out of restores, which only databases are", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([adapter("pg", "database"), adapter("s3", "storage")] as never);

        const result = await updateAdapterFlags(["pg", "s3"], { isRestoreExcluded: true });

        expect(result.succeeded).toEqual(["pg"]);
        expect(result.failed).toEqual([{ id: "s3", name: "conn-s3", error: "Only database connections are restore targets." }]);
    });

    it("marks destinations air-gapped and switches their integrity checks, but never those of a directory source", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            adapter("nas", "storage", { healthNotificationsDisabled: true }, "DESTINATION"),
            adapter("photos", "storage", null, "SOURCE"),
            adapter("pg", "database"),
        ] as never);

        const result = await updateAdapterFlags(["nas", "photos", "pg"], { airGapped: true });

        expect(result.succeeded).toEqual(["nas"]);
        expect(result.failed).toEqual([
            { id: "photos", name: "conn-photos", error: "Only a backup destination can be air-gapped." },
            { id: "pg", name: "conn-pg", error: "Only a backup destination can be air-gapped." },
        ]);
        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith({
            where: { id: "nas" },
            data: { metadata: JSON.stringify({ healthNotificationsDisabled: true, airGapped: true }) },
        });

        const checks = await updateAdapterFlags(["photos"], { skipVerification: true });
        expect(checks.failed).toEqual([{ id: "photos", name: "conn-photos", error: "Only backup destinations hold backups to check." }]);
    });

    it("refuses health check notifications for a notification channel and reports a missing connection", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([adapter("discord", "notification")] as never);

        const result = await updateAdapterFlags(["discord", "gone"], { healthNotificationsDisabled: false });

        expect(result.succeeded).toEqual([]);
        expect(result.failed.map((entry) => entry.id)).toEqual(["discord", "gone"]);
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });
});
