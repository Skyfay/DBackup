import { describe, it, expect, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { backupAuditDetails, fileRestoreTarget, restoreAuditDetails } from "@/services/storage/backup-audit";

const connections = [
    { id: "nas", name: "NAS" },
    { id: "pg-prod", name: "Prod PostgreSQL" },
    { id: "local", name: "Local files" },
];

describe("what the audit log names of a backup", () => {
    beforeEach(() => {
        prismaMock.adapterConfig.findMany.mockImplementation((async (args: { where: { id: { in: string[] } } }) =>
            connections.filter((connection) => args.where.id.in.includes(connection.id))) as never);
        prismaMock.job.findFirst.mockImplementation((async (args: { where: { name: string } }) =>
            (args.where.name === "Shop" ? { name: "Shop" } : null)) as never);
    });

    it("names the destination and the job whose folder the backup lies in, also in a chain folder", async () => {
        expect(await backupAuditDetails("nas", "Shop/chain-2026-09-01/full-000-shop.tar")).toEqual({
            file: "Shop/chain-2026-09-01/full-000-shop.tar",
            destination: "NAS",
            job: "Shop",
        });
        // Older versions kept every job folder under a shared folder.
        expect(await backupAuditDetails("nas", "backups/Shop/shop.sql.gz")).toMatchObject({ job: "Shop" });
    });

    it("names no job for a backup outside a job folder or of a job that no longer has that name", async () => {
        expect(await backupAuditDetails("nas", "shop.sql.gz")).toEqual({ file: "shop.sql.gz", destination: "NAS" });
        expect(await backupAuditDetails("nas", "Old name/shop.sql.gz")).toEqual({ file: "Old name/shop.sql.gz", destination: "NAS" });
    });

    it("still names the backup when the database cannot be read", async () => {
        prismaMock.adapterConfig.findMany.mockRejectedValue(new Error("database is locked"));
        prismaMock.job.findFirst.mockRejectedValue(new Error("database is locked"));

        expect(await backupAuditDetails("nas", "Shop/shop.sql.gz")).toEqual({ file: "Shop/shop.sql.gz" });
    });

    it("names every connection a restore went into, and the folders only when the restore took them", async () => {
        const request = {
            destinationId: "nas",
            file: "Shop/shop.tar",
            targetSourceId: "pg-prod",
            targetDatabaseName: "shop_copy",
            directoryMapping: [
                { entryId: "src-1", targetConfigId: "local", targetPath: "/restore", selected: true },
                { entryId: "src-2", targetConfigId: "nas", targetPath: "/other", selected: false },
            ],
        };

        expect(await restoreAuditDetails(request)).toEqual({
            action: "restore",
            file: "Shop/shop.tar",
            destination: "NAS",
            job: "Shop",
            target: "Prod PostgreSQL, Local files",
            databases: ["shop_copy"],
        });
        expect(await restoreAuditDetails({ ...request, scope: "databases" })).toMatchObject({ target: "Prod PostgreSQL" });
        const filesOnly = await restoreAuditDetails({ ...request, scope: "files" });
        expect(filesOnly).toMatchObject({ target: "Local files" });
        expect(filesOnly).not.toHaveProperty("databases");
    });

    it("says where restored files went: back where they came from, or a folder of a connection", async () => {
        expect(await fileRestoreTarget({ kind: "origin" })).toEqual({ target: "Original location" });
        expect(await fileRestoreTarget({ kind: "storage", configId: "local", basePath: "/restore" })).toEqual({ target: "Local files", targetPath: "/restore" });
    });
});
