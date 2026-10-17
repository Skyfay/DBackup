import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ConflictError, ValidationError } from "@/lib/logging/errors";

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/credential-validation", () => ({ validateCredentialAssignments: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/adapters/snapshot-validation", () => ({ validateSnapshotConfig: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/crypto", () => ({
    encryptConfig: (config: Record<string, unknown>) => ({ ...config, ...(config.password ? { password: `encrypted:${config.password}` } : {}) }),
}));

import { createAdapter } from "@/services/adapters/adapter-create";
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";

describe("creating a connection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
        prismaMock.adapterConfig.create.mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: "new", ...args.data })) as never);
    });

    it("stores the config with its secrets encrypted and the metadata as JSON", async () => {
        await createAdapter({
            name: "Shop",
            type: "database",
            adapterId: "mysql",
            config: { host: "db", port: 3306, password: "hunter2" },
            metadata: { healthNotificationsDisabled: false },
            primaryCredentialId: "cred-1",
        });

        const data = prismaMock.adapterConfig.create.mock.calls[0][0].data;
        expect(JSON.parse(data.config as string)).toEqual({ host: "db", port: 3306, password: "encrypted:hunter2" });
        expect(data.metadata).toBe('{"healthNotificationsDisabled":false}');
        expect(data.primaryCredentialId).toBe("cred-1");
        expect(validateCredentialAssignments).toHaveBeenCalledWith("mysql", "cred-1", null);
    });

    it("refuses a second connection of the same kind with the same name", async () => {
        prismaMock.adapterConfig.findFirst.mockResolvedValue({ id: "old" } as never);

        const created = createAdapter({ name: "NAS", type: "storage", adapterId: "local-filesystem", config: { basePath: "/backups" } });
        await expect(created).rejects.toBeInstanceOf(ConflictError);
        await expect(created).rejects.toThrow('A destination with the name "NAS" already exists.');
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("refuses a connection without a name", async () => {
        await expect(createAdapter({ name: "", type: "storage", adapterId: "local-filesystem", config: {} }))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses an adapter of another kind than the one whose permission was checked", async () => {
        await expect(createAdapter({ name: "Sneaky", type: "notification", adapterId: "mysql", config: { host: "db" } }))
            .rejects.toThrow("Unknown adapter for this kind of connection");
        await expect(createAdapter({ name: "Sneaky", type: "Storage", adapterId: "local-filesystem", config: { basePath: "/" } }))
            .rejects.toBeInstanceOf(ValidationError);
        expect(prismaMock.adapterConfig.create).not.toHaveBeenCalled();
    });

    it("keeps the role of a storage source and ignores a role on any other kind", async () => {
        await createAdapter({ name: "Files", type: "storage", adapterId: "local-filesystem", config: { basePath: "/srv" }, storageRole: "SOURCE" });
        await createAdapter({ name: "Mail", type: "notification", adapterId: "email", config: {}, storageRole: "SOURCE" });

        expect(prismaMock.adapterConfig.create.mock.calls[0][0].data.storageRole).toBe("SOURCE");
        expect(prismaMock.adapterConfig.create.mock.calls[1][0].data).not.toHaveProperty("storageRole");
    });
});
