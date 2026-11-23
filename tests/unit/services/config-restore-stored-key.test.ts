// @vitest-environment node
/**
 * The key a configuration backup at a destination opens with. A member of the home tenant may add
 * a key of their own to the Vault and write into a destination, so the AES-GCM tag of a file there
 * proves it came from DBackup only for the key of the configuration backup, or for a key the admin
 * picked or typed in the recovery dialog. The files are really encrypted and opened here.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { createCipheriv, randomBytes } from "crypto";
import { gzipSync } from "zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EncryptionKeyRequiredError } from "@/lib/logging/errors";

const KEYS: Record<string, Buffer> = {
    "config-key": Buffer.alloc(32, 0x11),
    "member-key": Buffer.alloc(32, 0x22),
};

const mocks = vi.hoisted(() => ({
    configKey: null as string | null,
    stored: { file: "", meta: "" },
    profiles: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: { findUnique: async () => ({ id: "home-nas", name: "NAS", type: "storage", storageRole: "DESTINATION", adapterId: "sftp", config: "{}" }) },
        systemSetting: { findUnique: async ({ where }: { where: { key: string } }) => (where.key === "config.backup.profileId" && mocks.configKey ? { value: mocks.configKey } : null) },
        user: { count: async () => 1 },
    },
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ id: "sftp" }) } }));
vi.mock("@/services/sharing/destination-access", () => ({
    isShared: async () => false,
    openRow: async () => ({
        adapter: {
            download: async (_config: unknown, _remote: string, local: string) => {
                copyFileSync(mocks.stored.file, local);
                return true;
            },
            read: async () => mocks.stored.meta,
        },
        config: {},
    }),
}));
vi.mock("@/services/backup/encryption-service", () => ({
    getProfileMasterKey: async (id: string) => {
        if (!KEYS[id]) throw new Error("Not found");
        return KEYS[id];
    },
    getEncryptionProfiles: (...args: unknown[]) => mocks.profiles(...args),
}));
vi.mock("@/services/vault/key-aliases", () => ({ rememberKeyFor: vi.fn() }));
vi.mock("@/services/config/import", () => ({ importConfiguration: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const root = mkdtempSync(path.join(os.tmpdir(), "dbackup-stored-key-"));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => root }));

const { checkStoredBackup, checkUploadedBackup } = await import("@/services/config/restore-flow");

const MANU = { userId: "u-manu" };
const FILE = "config-backups/config_backup_2026-11-08T03-00-00-000Z.json.gz.enc";
const CONFIG = JSON.stringify({ metadata: { version: "3.3.0", exportedAt: "2026-11-08T03:00:00.000Z" }, adapters: [], jobs: [], users: [{ id: "u-1" }], groups: [] });

/** Encrypts a configuration file with a key, as the configuration backup does, with the `.meta.json` naming a profile. */
function storeAt(key: Buffer, profileId: string | undefined): void {
    // The cipher of `createEncryptionStream`, all at once.
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(CONFIG))), cipher.final()]);
    mocks.stored.file = path.join(root, `stored-${Math.random().toString(36).slice(2)}.enc`);
    writeFileSync(mocks.stored.file, body);
    mocks.stored.meta = JSON.stringify({
        compression: "GZIP",
        sourceType: "SYSTEM",
        encryption: { enabled: true, ...(profileId ? { profileId } : {}), algorithm: "aes-256-gcm", iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") },
    });
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
    mocks.configKey = "config-key";
    mocks.profiles.mockResolvedValue(Object.keys(KEYS).map((id) => ({ id, name: id })));
    mocks.profiles.mockClear();
});

describe("the key a configuration backup at a destination opens with", () => {
    it("opens a file the configuration backup wrote with its key", async () => {
        storeAt(KEYS["config-key"], "config-key");

        await expect(checkStoredBackup("home-nas", FILE, undefined, MANU)).resolves.toMatchObject({ token: expect.any(String), preview: { kind: "json", counts: { users: 1 } } });
    });

    it("opens a file of the key of the configuration backup that names another profile, which it had before a reinstall", async () => {
        storeAt(KEYS["config-key"], "profile-of-the-old-instance");

        await expect(checkStoredBackup("home-nas", FILE, undefined, MANU)).resolves.toMatchObject({ token: expect.any(String) });
    });

    it("refuses a file a member encrypted with a key they added to the Vault, whatever its metadata names", async () => {
        storeAt(KEYS["member-key"], "member-key");
        // Without the key the file names, so the key dialog never offers the member's key.
        await expect(checkStoredBackup("home-nas", FILE, undefined, MANU)).rejects.toMatchObject({ name: expect.any(String), profileId: undefined });
        await expect(checkStoredBackup("home-nas", FILE, undefined, MANU)).rejects.toBeInstanceOf(EncryptionKeyRequiredError);

        storeAt(KEYS["member-key"], undefined);
        await expect(checkStoredBackup("home-nas", FILE, undefined, MANU)).rejects.toThrow("only with the key picked under Configuration backup");

        storeAt(KEYS["member-key"], "config-key");
        await expect(checkStoredBackup("home-nas", FILE, undefined, MANU)).rejects.toBeInstanceOf(EncryptionKeyRequiredError);

        // No Smart Recovery over the Vault, which holds the key of the member.
        expect(mocks.profiles).not.toHaveBeenCalled();
    });

    it("refuses an encrypted file while no key is picked under Configuration backup", async () => {
        mocks.configKey = null;
        storeAt(KEYS["config-key"], "config-key");

        await expect(checkStoredBackup("home-nas", FILE, undefined, MANU)).rejects.toBeInstanceOf(EncryptionKeyRequiredError);
    });

    it("opens a file with a key the admin picked or typed in the recovery dialog", async () => {
        mocks.configKey = null;
        storeAt(KEYS["member-key"], undefined);

        await expect(checkStoredBackup("home-nas", FILE, { profileId: "member-key" }, MANU)).resolves.toMatchObject({ token: expect.any(String) });
        await expect(checkStoredBackup("home-nas", FILE, { rawKeyHex: KEYS["member-key"].toString("hex") }, MANU)).resolves.toMatchObject({ token: expect.any(String) });
    });

    it("still searches the Vault for the key of an upload, which the admin picked themselves", async () => {
        storeAt(KEYS["member-key"], undefined);
        const upload = { backup: new File([readFileSync(mocks.stored.file)], path.basename(FILE)), meta: new File([mocks.stored.meta], `${path.basename(FILE)}.meta.json`) };

        await expect(checkUploadedBackup(upload, MANU)).resolves.toMatchObject({ token: expect.any(String) });
        expect(mocks.profiles).toHaveBeenCalled();
    });
});
