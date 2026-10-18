/**
 * What counts as a configuration backup, the copy of the whole DBackup database that only a platform
 * admin with a session opens: a file in `config-backups/` at the root of a destination, a file named
 * like one, or a file whose sidecar says `sourceType: "SYSTEM"`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isConfigBackupPath } from "@/lib/core/config-backup-path";
import { readsConfigBackups } from "@/lib/server/config-backup-guard";
import type { StorageViewMode } from "@/lib/tenant/storage-view";

const mocks = vi.hoisted(() => ({
    mode: { kind: "own" } as StorageViewMode,
    sidecars: new Map<string, string>(),
    open: vi.fn(),
    read: vi.fn(),
}));

vi.mock("@/services/sharing/destination-access", () => ({
    openDestination: (...args: unknown[]) => mocks.open(...args),
}));

const { isConfigBackupFile } = await import("@/services/storage/config-backup-access");

beforeEach(() => {
    vi.clearAllMocks();
    mocks.mode = { kind: "own" };
    mocks.sidecars = new Map();
    mocks.read.mockImplementation(async (_config: unknown, remote: string) => mocks.sidecars.get(remote) ?? null);
    mocks.open.mockImplementation(async () => ({
        mode: mocks.mode,
        config: {},
        adapter: { read: mocks.read, download: vi.fn(async () => false) },
    }));
});

describe("a configuration backup by its path", () => {
    it("lies in the folder of the configuration backup, also as a storage that ignores the case and trailing dots reads it", () => {
        expect(isConfigBackupPath("config-backups/config_backup_2026-10-18.db.gz.enc")).toBe(true);
        expect(isConfigBackupPath("/Config-Backups./anything.db.gz.enc")).toBe(true);
        expect(isConfigBackupPath("config-backups\\x.meta.json")).toBe(true);
    });

    it("is named like the files of the configuration backup anywhere", () => {
        expect(isConfigBackupPath("moved/CONFIG_BACKUP_2026-10-18.db.gz.enc")).toBe(true);
    });

    it("is never a backup of a job", () => {
        expect(isConfigBackupPath("nightly/shop_2026-10-18.tar")).toBe(false);
        expect(isConfigBackupPath("nightly/config-backups/shop.tar")).toBe(false);
        expect(isConfigBackupPath("")).toBe(false);
    });
});

describe("a configuration backup at a destination", () => {
    it("is told by its path on a destination of its own tenant, without reading its sidecar", async () => {
        expect(await isConfigBackupFile("nas", "config-backups/config_backup_1.db.gz.enc", "default")).toBe(true);
        expect(mocks.open).toHaveBeenCalledWith("nas", "default");
        expect(mocks.read).not.toHaveBeenCalled();
    });

    it("is told by its sidecar when it was moved or renamed", async () => {
        mocks.mode = { kind: "provider" };
        mocks.sidecars.set("archive/renamed.db.gz.enc.meta.json", JSON.stringify({ sourceType: "SYSTEM" }));

        expect(await isConfigBackupFile("nas", "archive/renamed.db.gz.enc")).toBe(true);
    });

    it("is never a backup of a job, whose sidecar names its engine", async () => {
        mocks.sidecars.set("nightly/shop.tar.meta.json", JSON.stringify({ sourceType: "mysql" }));

        expect(await isConfigBackupFile("nas", "nightly/shop.tar")).toBe(false);
    });

    it("is never a backup of a customer by its path, since the configuration backup never writes into the folder of a customer", async () => {
        mocks.mode = { kind: "customer", tenantId: "acme" };
        mocks.sidecars.set("config-backups/shop.tar.meta.json", JSON.stringify({ sourceType: "mysql" }));

        expect(await isConfigBackupFile("nas", "config-backups/shop.tar", "acme")).toBe(false);
    });

    it("leaves the path to decide when the destination cannot be opened", async () => {
        mocks.open.mockRejectedValue(new Error("not found"));

        expect(await isConfigBackupFile("nas", "config-backups/config_backup_1.db.gz.enc")).toBe(true);
        expect(await isConfigBackupFile("nas", "nightly/shop.tar")).toBe(false);
    });
});

describe("who opens a configuration backup", () => {
    it("is a platform admin signed in with a session and nobody else", () => {
        expect(readsConfigBackups({ isPlatformAdmin: true, authMethod: "session" })).toBe(true);
        expect(readsConfigBackups({ isPlatformAdmin: false, authMethod: "session" })).toBe(false);
        expect(readsConfigBackups({ isPlatformAdmin: true, authMethod: "apikey" })).toBe(false);
    });
});
