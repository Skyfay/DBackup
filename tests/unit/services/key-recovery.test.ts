import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { serializeIndex } from "@/lib/archive/index-file";
import { ValidationError } from "@/lib/logging/errors";

const RIGHT_KEY = crypto.randomBytes(32);
const WRONG_KEY = crypto.randomBytes(32);
const KDF_SALT = crypto.randomBytes(32);
const NONCE_PREFIX = crypto.randomBytes(4);

const prismaMock = { adapterConfig: { findUnique: vi.fn() } };
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const registryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...a: unknown[]) => registryGet(...a) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => "/tmp" }));

const fetchSidecar = vi.fn();
vi.mock("@/services/backup/archive-index-service", () => ({
    archiveIndexService: { fetchSidecar: (...a: unknown[]) => fetchSidecar(...a) },
}));

const getEncryptionProfiles = vi.fn();
const findProfileByKey = vi.fn();
const importEncryptionProfile = vi.fn();
vi.mock("@/services/backup/encryption-service", () => ({
    getEncryptionProfiles: (...a: unknown[]) => getEncryptionProfiles(...a),
    findProfileByKey: (...a: unknown[]) => findProfileByKey(...a),
    importEncryptionProfile: (...a: unknown[]) => importEncryptionProfile(...a),
}));

const { recoverEncryptionKey } = await import("@/services/backup/key-recovery");

const ARCHIVE_META = {
    version: 1,
    jobName: "FileBackup",
    archive: {
        formatVersion: 2,
        indexFile: ".index",
        encrypted: true,
        profileId: "deleted-profile",
        kdfSalt: KDF_SALT.toString("hex"),
        noncePrefix: NONCE_PREFIX.toString("hex"),
    },
};

/** A real sealed index, so the verifier's crypto runs unmocked. */
async function sealedIndex(masterKey: Buffer): Promise<Buffer> {
    const { indexKey } = deriveArchiveKeys(masterKey, KDF_SALT);
    return serializeIndex(
        [{ k: "h", v: 2, createdAt: "2026-07-25T20:10:37.652Z", archive: "FileBackup_inc-001.tar" }],
        { indexKey, noncePrefix: NONCE_PREFIX }
    );
}

function setupArchiveBackup() {
    prismaMock.adapterConfig.findUnique.mockResolvedValue({
        id: "dest-1", type: "storage", adapterId: "local-filesystem", config: "{}",
    });
    registryGet.mockReturnValue({
        id: "local-filesystem",
        read: vi.fn().mockResolvedValue(JSON.stringify(ARCHIVE_META)),
        download: vi.fn().mockResolvedValue(true),
    });
}

describe("recoverEncryptionKey", () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        getEncryptionProfiles.mockResolvedValue([]);
        findProfileByKey.mockResolvedValue(null);
        importEncryptionProfile.mockImplementation(async (name: string) => ({ id: "new-profile", name }));
        fetchSidecar.mockResolvedValue(await sealedIndex(RIGHT_KEY));
        setupArchiveBackup();
    });

    it("stores a key that opens the backup, named after the job it came from", async () => {
        const result = await recoverEncryptionKey("dest-1", "FileBackup/inc-001.tar", RIGHT_KEY.toString("hex"));

        expect(result).toMatchObject({ status: "imported", profileId: "new-profile" });
        expect(importEncryptionProfile).toHaveBeenCalledWith(
            "Recovered - FileBackup",
            RIGHT_KEY.toString("hex"),
            expect.stringContaining("inc-001.tar"),
            // The profile the backup names, so the Vault counts its backups under the new key.
            ["deleted-profile"]
        );
    });

    it("stores nothing when the key does not open the backup", async () => {
        const result = await recoverEncryptionKey("dest-1", "FileBackup/inc-001.tar", WRONG_KEY.toString("hex"));

        // The whole point of checking first: a wrong key in the vault would look like a
        // working one until the next restore failed for a far less obvious reason.
        expect(result).toEqual({ status: "rejected" });
        expect(importEncryptionProfile).not.toHaveBeenCalled();
    });

    it("points at the existing profile rather than storing the same key twice", async () => {
        findProfileByKey.mockResolvedValue({ id: "already-here", name: "My Key" });

        const result = await recoverEncryptionKey("dest-1", "FileBackup/inc-001.tar", RIGHT_KEY.toString("hex"));

        expect(result).toMatchObject({ status: "existing", profileId: "already-here", profileName: "My Key" });
        expect(findProfileByKey).toHaveBeenCalledWith(RIGHT_KEY.toString("hex"));
        expect(importEncryptionProfile).not.toHaveBeenCalled();
    });

    it("avoids colliding with a profile name that is already taken", async () => {
        getEncryptionProfiles.mockResolvedValue([{ id: "other", name: "Recovered - FileBackup" }]);

        await recoverEncryptionKey("dest-1", "FileBackup/inc-001.tar", RIGHT_KEY.toString("hex"));

        expect(importEncryptionProfile).toHaveBeenCalledWith(
            "Recovered - FileBackup (2)", expect.anything(), expect.anything(), expect.anything()
        );
    });

    it("keeps the name the user chose", async () => {
        await recoverEncryptionKey("dest-1", "FileBackup/inc-001.tar", RIGHT_KEY.toString("hex"), "Old laptop key");

        expect(importEncryptionProfile).toHaveBeenCalledWith(
            "Old laptop key", expect.anything(), expect.anything(), expect.anything()
        );
    });

    it("rejects a key that is not 32 bytes of hex before touching the backup", async () => {
        await expect(recoverEncryptionKey("dest-1", "FileBackup/inc-001.tar", "nonsense"))
            .rejects.toBeInstanceOf(ValidationError);
        expect(fetchSidecar).not.toHaveBeenCalled();
    });

    it("refuses a backup that is not encrypted at all", async () => {
        registryGet.mockReturnValue({
            id: "local-filesystem",
            read: vi.fn().mockResolvedValue(JSON.stringify({ version: 1, jobName: "Plain" })),
            download: vi.fn().mockResolvedValue(true),
        });

        await expect(recoverEncryptionKey("dest-1", "plain.sql", RIGHT_KEY.toString("hex")))
            .rejects.toThrow("not encrypted");
    });
});
