/**
 * A passing Test connection keeps the version it found with the saved connection. Only when the
 * test tried that connection: the version of another server, or of the server DBackup runs on tried
 * by someone who may not, would otherwise pass for the version of the saved one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({ mayReachHost: vi.fn(), run: vi.fn() }));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: (id: string) => ({ id, test: vi.fn() }) } }));
vi.mock("@/lib/transport/adapter-invoke", () => ({ runAdapterTest: (...args: unknown[]) => mocks.run(...args) }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    applyStoredSecrets: async (_adapterId: string, _id: string, config: Record<string, unknown>) => config,
    overlayCredentialsOnConfig: async (_adapterId: string, config: Record<string, unknown>) => config,
    mayReachHost: () => mocks.mayReachHost(),
}));
vi.mock("@/lib/crypto", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/crypto")>()),
    decryptConfig: (config: unknown) => config,
}));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

const { testConnection } = await import("@/services/adapters/connection-test");

const saved = (adapterId: string, config: Record<string, unknown>) =>
    prismaMock.adapterConfig.findUnique.mockResolvedValue({ adapterId, config: JSON.stringify(config), metadata: null } as never);

describe("the version a connection test keeps with the saved connection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.run.mockResolvedValue({ success: true, message: "Connected", version: "8.0.36" });
        mocks.mayReachHost.mockResolvedValue(false);
    });

    it("is kept when the test tried the saved connection", async () => {
        saved("mysql", { host: "db.internal", port: 3306 });

        await testConnection({ adapterId: "mysql", config: { host: "db.internal", port: 3306 }, configId: "shop", storedConfigId: "shop" });

        expect(prismaMock.adapterConfig.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "shop" } }));
    });

    it("is not kept for another server, another adapter or a connection that is gone", async () => {
        saved("mysql", { host: "db.internal", port: 3306 });
        await testConnection({ adapterId: "mysql", config: { host: "other.internal", port: 3306 }, configId: "shop" });
        await testConnection({ adapterId: "mysql", config: { host: "db.internal", port: 3307 }, configId: "shop" });
        await testConnection({ adapterId: "postgres", config: { host: "db.internal", port: 3306 }, configId: "shop" });
        prismaMock.adapterConfig.findUnique.mockResolvedValue(null);
        await testConnection({ adapterId: "mysql", config: { host: "db.internal", port: 3306 }, configId: "shop" });

        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("is kept for a connection to the server DBackup runs on only from whoever may test one", async () => {
        const local = { connectionMode: "direct", socketPath: "/var/run/docker.sock" };
        saved("docker-volume", local);

        await testConnection({ adapterId: "docker-volume", config: local, configId: "docker" });
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();

        mocks.mayReachHost.mockResolvedValue(true);
        await testConnection({ adapterId: "docker-volume", config: local, configId: "docker" });
        expect(prismaMock.adapterConfig.update).toHaveBeenCalledTimes(1);
    });
});
