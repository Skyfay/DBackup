import { describe, it, expect } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { updateAdapterFlags } from "@/services/adapters/adapter-service";

const adapter = (id: string, type: string, metadata: Record<string, unknown> | null = null) => ({
    id,
    name: `conn-${id}`,
    type,
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

    it("refuses health check notifications for a notification channel and reports a missing connection", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([adapter("discord", "notification")] as never);

        const result = await updateAdapterFlags(["discord", "gone"], { healthNotificationsDisabled: false });

        expect(result.succeeded).toEqual([]);
        expect(result.failed.map((entry) => entry.id)).toEqual(["discord", "gone"]);
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });
});
