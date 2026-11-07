/**
 * The storage a directory is restored into is opened the way the tenant that restores sees it.
 * The request names the id and the path, so without that the tenant of a shared destination could
 * write into `tenants/<customer>/` of it, and anyone into a storage of another tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    providedConnection: vi.fn(),
    upload: vi.fn(),
    test: vi.fn(),
}));

vi.mock("@/lib/core/registry", () => ({ registry: { get: (...args: unknown[]) => mocks.get(...args) } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn().mockResolvedValue({ basePath: "/backups" }) }));
vi.mock("@/services/sharing/provided", () => ({ providedConnection: (...args: unknown[]) => mocks.providedConnection(...args) }));

import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsTenant } from "@/lib/tenant/context";
import { openDirectoryTarget } from "@/services/restore/archive-restore";
import { preflightRestore } from "@/services/restore/preflight";

const row = (overrides: Record<string, unknown> = {}) => ({
    id: "nas", name: "NAS", type: "storage", adapterId: "sftp", tenantId: "msp", storageRole: "DESTINATION", config: "{}",
    primaryCredentialId: null, sshCredentialId: null, ...overrides,
});

describe("the storage a directory is restored into", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockReturnValue({ id: "sftp", upload: mocks.upload, test: mocks.test, list: vi.fn().mockResolvedValue([]) });
        mocks.upload.mockResolvedValue(true);
        mocks.test.mockResolvedValue({ success: true });
        mocks.providedConnection.mockResolvedValue(null);
        prismaMock.adapterConfig.findUnique.mockResolvedValue(row() as never);
        prismaMock.connectionShare.count.mockResolvedValue(0);
    });

    it("is the plain storage for a storage of the own tenant nobody shares", async () => {
        const target = await runAsTenant("msp", () => openDirectoryTarget("nas"));

        expect(target.mode).toEqual({ kind: "own" });
        await target.adapter.upload(target.config, "/tmp/file", "tenants/acme/file");
        expect(mocks.upload).toHaveBeenCalledWith({ basePath: "/backups" }, "/tmp/file", "tenants/acme/file");
    });

    it("never writes into the folders of the customers of a destination its tenant shares", async () => {
        prismaMock.connectionShare.count.mockResolvedValue(1);
        const target = await runAsTenant("msp", () => openDirectoryTarget("nas"));

        expect(target.mode).toEqual({ kind: "provider" });
        const upload = Promise.resolve().then(() => target.adapter.upload(target.config, "/tmp/file", "/tenants/acme/www/index.html"));
        await expect(upload).rejects.toThrow("tenants/");
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    it("writes into the own folder of a customer on a destination shared with it", async () => {
        mocks.providedConnection.mockResolvedValue({ id: "nas" });
        const target = await runAsTenant("acme", () => openDirectoryTarget("nas"));

        expect(target.mode).toEqual({ kind: "customer", tenantId: "acme" });
        await target.adapter.upload(target.config, "/tmp/file", "/restored/file");
        expect(mocks.upload).toHaveBeenCalledWith({ basePath: "/backups" }, "/tmp/file", "tenants/acme/restored/file", undefined, undefined, undefined);
    });

    it("finds no storage of another tenant that is not shared with the one that restores", async () => {
        await expect(runAsTenant("acme", () => openDirectoryTarget("nas"))).rejects.toThrow("Restore target adapter not found");
        prismaMock.adapterConfig.findUnique.mockResolvedValue(null);
        await expect(runAsTenant("msp", () => openDirectoryTarget("gone"))).rejects.toThrow("Restore target adapter not found");
    });

    it("finds no destination shared with the customer that takes only encrypted backups, since restored files land on it in plain text", async () => {
        mocks.providedConnection.mockResolvedValue({ id: "nas", encryptedOnly: true });

        await expect(runAsTenant("acme", () => openDirectoryTarget("nas"))).rejects.toThrow("Restore target adapter not found");
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    describe("in the preflight", () => {
        const input = { storageConfigId: "backups", file: "/backup.tar", directoryMapping: [{ entryId: "src-1", targetConfigId: "nas", targetPath: "/restore", selected: true }] };

        it("refuses a storage of another tenant that is not shared with the one that restores", async () => {
            // The archive lies on a destination shared with the customer, the target is no such one.
            prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => row({ id: where.id })) as never);
            mocks.providedConnection.mockImplementation(async (id: string) => (id === "backups" ? { id } : null));
            await expect(runAsTenant("acme", () => preflightRestore(input))).rejects.toThrow("Invalid restore target for a directory entry: adapter 'nas' not found");
            expect(mocks.test).not.toHaveBeenCalled();
        });

        it("refuses a destination shared with the customer that takes only encrypted backups, like one that does not exist", async () => {
            prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => row({ id: where.id })) as never);
            mocks.providedConnection.mockImplementation(async (id: string) => (id === "backups" ? { id, encryptedOnly: false } : { id, encryptedOnly: true }));
            await expect(runAsTenant("acme", () => preflightRestore(input))).rejects.toThrow("Invalid restore target for a directory entry: adapter 'nas' not found");
        });

        it("probes the own storage, but not the top of a destination another tenant shares, which is not the customer's", async () => {
            await runAsTenant("msp", () => preflightRestore(input));
            expect(mocks.test).toHaveBeenCalledTimes(1);

            mocks.test.mockClear();
            mocks.providedConnection.mockResolvedValue({ id: "nas" });
            await runAsTenant("acme", () => preflightRestore(input));
            expect(mocks.test).not.toHaveBeenCalled();
        });
    });
});
