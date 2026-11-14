// @vitest-environment node
/**
 * The key of the configuration backup opens a file encrypted as one stream only for a platform
 * admin with a session. A configuration backup is told from a backup of a job by its path and its
 * sidecar, which whoever stores a copy of it chooses, so a copy under the name of a job must not
 * open with that key for anyone who may download backups, whether the sidecar names the key, the
 * request picks it or Smart Recovery would find it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import { createReadStream, createWriteStream, existsSync } from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { createGzip, gunzipSync } from "zlib";
import { createEncryptionStream } from "@/lib/crypto/stream";
import { PermissionError } from "@/lib/logging/errors";
import { CONFIG_BACKUP_KEY_USE_LOCKED } from "@/lib/core/config-backup-locks";

const CONFIG_KEY_ID = "key-config";
const JOB_KEY_ID = "key-jobs";
const KEYS: Record<string, Buffer> = { [CONFIG_KEY_ID]: Buffer.alloc(32, 0x11), [JOB_KEY_ID]: Buffer.alloc(32, 0x22) };
const PLAIN = "DUMMY-CONFIG-COPY ENCRYPTION_KEY=dummy\n".repeat(40);

const prismaMock = vi.hoisted(() => ({
    systemSetting: { findUnique: vi.fn() },
    execution: { findMany: vi.fn() },
    job: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
const destination = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock("@/services/sharing/destination-access", () => ({
    openDestination: async () => ({ adapter: destination.adapter, config: {} }),
    findDestination: vi.fn(),
    openRow: vi.fn(),
}));
vi.mock("@/services/backup/encryption-service", () => ({
    getProfileMasterKey: async (id: string) => {
        if (!KEYS[id]) throw new Error(`Profile ${id} not found`);
        return KEYS[id];
    },
    getEncryptionProfiles: async () => Object.keys(KEYS).map((id) => ({ id, name: id })),
}));
vi.mock("@/services/vault/key-aliases", () => ({ rememberKeyFor: async () => false }));

const { storageService } = await import("@/services/storage/storage-service");
const { wholeFileKeyRefusal } = await import("@/services/backup/config-key-lock");
const { resolveBackupKey } = await import("@/services/backup/key-resolution");

const MEMBER = { isPlatformAdmin: false, authMethod: "session" } as const;
const ADMIN = { isPlatformAdmin: true, authMethod: "session" } as const;
const ADMIN_KEY = { isPlatformAdmin: true, authMethod: "apikey" } as const;

let workDir: string;

/** A file encrypted the way the configuration backup is, stored under the name of a job with a sidecar of a job. */
async function storeCopy(remote: string, keyId: string, namedProfile: string) {
    const plain = path.join(workDir, "plain");
    await fs.writeFile(plain, PLAIN);
    const target = path.join(workDir, remote);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const { stream, getAuthTag, iv } = createEncryptionStream(KEYS[keyId]);
    await pipeline(createReadStream(plain), createGzip(), stream, createWriteStream(target));
    await fs.writeFile(`${target}.meta.json`, JSON.stringify({
        version: 1, jobName: "nightly", sourceType: "mysql", compression: "GZIP",
        encryption: { enabled: true, profileId: namedProfile, algorithm: "aes-256-gcm", iv: iv.toString("hex"), authTag: getAuthTag().toString("hex") },
    }));
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-key-use-"));
    prismaMock.systemSetting.findUnique.mockResolvedValue({ value: CONFIG_KEY_ID });
    prismaMock.execution.findMany.mockResolvedValue([]);
    prismaMock.job.findUnique.mockResolvedValue(null);
    destination.adapter = {
        id: "nas-fs",
        read: async (_c: unknown, remote: string) => fs.readFile(path.join(workDir, remote), "utf-8").catch(() => null),
        download: async (_c: unknown, remote: string, local: string) => fs.copyFile(path.join(workDir, remote), local).then(() => true, () => false),
    };
});
afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });

describe("a decrypted download of a copy of the configuration backup under the name of a job", () => {
    const download = (file: string, options: Record<string, unknown>) =>
        storageService.downloadFile("nas", file, path.join(workDir, "out"), true, options);

    it("is refused to a member when its sidecar names the key of the configuration backup", async () => {
        await storeCopy("nightly/a.sql.gz.enc", CONFIG_KEY_ID, CONFIG_KEY_ID);
        await expect(download("nightly/a.sql.gz.enc", { caller: MEMBER })).rejects.toBeInstanceOf(PermissionError);
        await expect(download("nightly/a.sql.gz.enc", { caller: MEMBER })).rejects.toThrow(CONFIG_BACKUP_KEY_USE_LOCKED);
    });

    it("is refused to a member who picks that key in the request", async () => {
        await storeCopy("nightly/b.sql.gz.enc", CONFIG_KEY_ID, "gone");
        await expect(download("nightly/b.sql.gz.enc", { caller: MEMBER, profileIdOverride: CONFIG_KEY_ID })).rejects.toBeInstanceOf(PermissionError);
    });

    it("never opens through Smart Recovery, which leaves that key out for a member", async () => {
        await storeCopy("nightly/c.sql.gz.enc", CONFIG_KEY_ID, "gone");
        await expect(download("nightly/c.sql.gz.enc", { caller: MEMBER })).rejects.toThrow(/no other profile could decrypt/);
        const out = path.join(workDir, "out");
        // Whatever is left of the download, it is not the plain text.
        if (existsSync(out)) expect((await fs.readFile(out)).includes("DUMMY-CONFIG-COPY")).toBe(false);
    });

    it("is refused to an API key of a platform admin and to a caller nobody names", async () => {
        await storeCopy("nightly/a.sql.gz.enc", CONFIG_KEY_ID, CONFIG_KEY_ID);
        await expect(download("nightly/a.sql.gz.enc", { caller: ADMIN_KEY })).rejects.toBeInstanceOf(PermissionError);
        await expect(download("nightly/a.sql.gz.enc", {})).rejects.toBeInstanceOf(PermissionError);
    });

    it("opens for a platform admin with a session", async () => {
        await storeCopy("nightly/a.sql.gz.enc", CONFIG_KEY_ID, CONFIG_KEY_ID);
        await expect(download("nightly/a.sql.gz.enc", { caller: ADMIN })).resolves.toMatchObject({ success: true });
        expect(gunzipSync(await fs.readFile(path.join(workDir, "out"))).toString()).toBe(PLAIN);
    });

    it("still opens an older backup of a job under another key for a member, also through Smart Recovery", async () => {
        await storeCopy("nightly/old.sql.gz.enc", JOB_KEY_ID, JOB_KEY_ID);
        await expect(download("nightly/old.sql.gz.enc", { caller: MEMBER })).resolves.toMatchObject({ success: true });
        expect(gunzipSync(await fs.readFile(path.join(workDir, "out"))).toString()).toBe(PLAIN);

        await storeCopy("nightly/moved.sql.gz.enc", JOB_KEY_ID, "gone");
        await expect(download("nightly/moved.sql.gz.enc", { caller: MEMBER })).resolves.toMatchObject({ success: true });
    });
});

describe("the keys a decryption of a whole file may use", () => {
    it("leave out the key of the configuration backup for anyone but a platform admin with a session", async () => {
        expect(await wholeFileKeyRefusal(MEMBER)(CONFIG_KEY_ID)).toBe(true);
        expect(await wholeFileKeyRefusal(ADMIN_KEY)(CONFIG_KEY_ID)).toBe(true);
        expect(await wholeFileKeyRefusal(undefined)(CONFIG_KEY_ID)).toBe(true);
        expect(await wholeFileKeyRefusal(MEMBER)(JOB_KEY_ID)).toBe(false);
        expect(await wholeFileKeyRefusal(ADMIN)(CONFIG_KEY_ID)).toBe(false);
    });

    it("stay as they were where no refusal is asked, like for a seekable archive", async () => {
        await expect(resolveBackupKey({ profileId: CONFIG_KEY_ID })).resolves.toEqual(KEYS[CONFIG_KEY_ID]);
    });

    it("take a key the caller holds and types in themselves", async () => {
        const key = await resolveBackupKey({ profileId: "gone", override: { rawKeyHex: KEYS[CONFIG_KEY_ID].toString("hex") }, refuse: wholeFileKeyRefusal(MEMBER) });
        expect(key).toEqual(KEYS[CONFIG_KEY_ID]);
    });
});
