// @vitest-environment node
/**
 * Removing a folder once it is empty, which the cleanup of a customer's backups on a shared
 * destination asks for: never a folder with anything in it, and never the folder the destination
 * is set to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({ rmdir: vi.fn(), removeEmptyDir: vi.fn() }));

vi.mock("ssh2-sftp-client", () => {
    class MockSFTPClient {
        connect = vi.fn().mockResolvedValue(undefined);
        end = vi.fn().mockResolvedValue(undefined);
        rmdir = mocks.rmdir;
    }
    return { default: MockSFTPClient };
});
vi.mock("basic-ftp", () => {
    class MockClient {
        ftp = { verbose: false };
        access = vi.fn().mockResolvedValue(undefined);
        close = vi.fn();
        removeEmptyDir = mocks.removeEmptyDir;
    }
    return { Client: MockClient, FTPError: class extends Error {} };
});

const { LocalFileSystemAdapter } = await import("@/lib/adapters/storage/local");
const { SFTPAdapter } = await import("@/lib/adapters/storage/sftp");
const { FTPAdapter } = await import("@/lib/adapters/storage/ftp");

describe("removing an empty folder", () => {
    describe("on the local filesystem", () => {
        let root = "";

        beforeEach(async () => {
            root = await fs.mkdtemp(path.join(os.tmpdir(), "empty-folder-"));
            await fs.mkdir(path.join(root, "tenants/acme/Shop"), { recursive: true });
            await fs.mkdir(path.join(root, "tenants/acme/CRM"), { recursive: true });
            await fs.writeFile(path.join(root, "tenants/acme/CRM/crm.tar"), "x");
        });

        afterEach(async () => {
            await fs.rm(root, { recursive: true, force: true });
        });

        it("removes an empty folder and keeps one that holds something", async () => {
            expect(await LocalFileSystemAdapter.deleteEmptyFolder!({ basePath: root }, "tenants/acme/Shop")).toBe(true);
            expect(await LocalFileSystemAdapter.deleteEmptyFolder!({ basePath: root }, "tenants/acme")).toBe(false);
            await expect(fs.stat(path.join(root, "tenants/acme/Shop"))).rejects.toThrow();
            expect((await fs.stat(path.join(root, "tenants/acme/CRM/crm.tar"))).isFile()).toBe(true);
        });

        it("never removes the folder the destination is set to, and nothing outside it", async () => {
            const empty = await fs.mkdtemp(path.join(os.tmpdir(), "empty-base-"));
            try {
                expect(await LocalFileSystemAdapter.deleteEmptyFolder!({ basePath: empty }, "")).toBe(false);
                expect(await LocalFileSystemAdapter.deleteEmptyFolder!({ basePath: empty }, "/")).toBe(false);
                expect((await fs.stat(empty)).isDirectory()).toBe(true);
            } finally {
                await fs.rm(empty, { recursive: true, force: true });
            }
            await expect(LocalFileSystemAdapter.deleteEmptyFolder!({ basePath: root }, "../outside")).rejects.toThrow("Access denied");
        });
    });

    describe("over SFTP and FTP", () => {
        const sftp = { host: "sftp.example.com", port: 22, username: "backup", password: "secret", pathPrefix: "/backups" };
        const ftp = { host: "ftp.example.com", port: 21, username: "backup", password: "secret", tls: false, pathPrefix: "/backups" };

        beforeEach(() => {
            mocks.rmdir.mockReset().mockResolvedValue("Successfully removed directory");
            mocks.removeEmptyDir.mockReset().mockResolvedValue({ code: 250 });
        });

        it("asks the server to remove the folder alone, never with what is in it", async () => {
            expect(await SFTPAdapter.deleteEmptyFolder!(sftp as never, "tenants/acme")).toBe(true);
            expect(mocks.rmdir).toHaveBeenCalledWith("/backups/tenants/acme", false);

            expect(await FTPAdapter.deleteEmptyFolder!(ftp as never, "tenants/acme")).toBe(true);
            expect(mocks.removeEmptyDir).toHaveBeenCalledWith("/backups/tenants/acme");
        });

        it("answers false when the server refuses a folder that holds something", async () => {
            mocks.rmdir.mockRejectedValue(new Error("Failure /backups/tenants/acme"));
            mocks.removeEmptyDir.mockRejectedValue(new Error("550 Directory not empty"));

            expect(await SFTPAdapter.deleteEmptyFolder!(sftp as never, "tenants/acme")).toBe(false);
            expect(await FTPAdapter.deleteEmptyFolder!(ftp as never, "tenants/acme")).toBe(false);
        });

        it("never asks for the folder the destination is set to", async () => {
            expect(await SFTPAdapter.deleteEmptyFolder!(sftp as never, "")).toBe(false);
            expect(await FTPAdapter.deleteEmptyFolder!(ftp as never, "/")).toBe(false);
            expect(mocks.rmdir).not.toHaveBeenCalled();
            expect(mocks.removeEmptyDir).not.toHaveBeenCalled();
        });
    });
});
