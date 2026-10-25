import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { serializeIndex } from "@/lib/archive/index-file";
import { EncryptionKeyRequiredError, ValidationError } from "@/lib/logging/errors";
import {
    archiveIndexVerifier,
    resolveBackupKey,
    type KeyVerifier,
} from "@/services/backup/key-resolution";
import * as encryptionService from "@/services/backup/encryption-service";

vi.mock("@/services/backup/encryption-service", () => ({
    getProfileMasterKey: vi.fn(),
    getEncryptionProfiles: vi.fn(),
}));

const getProfileMasterKey = encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>;
const getEncryptionProfiles = encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>;

const RIGHT_KEY = crypto.randomBytes(32);
const WRONG_KEY = crypto.randomBytes(32);

/** Accepts only RIGHT_KEY, standing in for whatever a real format checks. */
const acceptsRightKey: KeyVerifier = async (candidate) => candidate.equals(RIGHT_KEY);

describe("resolveBackupKey", () => {
    beforeEach(() => vi.clearAllMocks());

    it("uses a raw key the caller supplied without consulting the vault", async () => {
        const key = await resolveBackupKey({
            profileId: "gone",
            override: { rawKeyHex: RIGHT_KEY.toString("hex") },
            verify: acceptsRightKey,
        });

        expect(key).toEqual(RIGHT_KEY);
        expect(getProfileMasterKey).not.toHaveBeenCalled();
        expect(getEncryptionProfiles).not.toHaveBeenCalled();
    });

    it("reports a supplied key that does not open the backup instead of falling back to the vault", async () => {
        await expect(
            resolveBackupKey({
                profileId: "gone",
                override: { rawKeyHex: WRONG_KEY.toString("hex") },
                verify: acceptsRightKey,
            })
        ).rejects.toThrow("The supplied key does not open this backup.");

        // The user made an explicit choice - answering with some other profile's key would
        // hide that the key they hold is the wrong one.
        expect(getEncryptionProfiles).not.toHaveBeenCalled();
    });

    it("rejects a raw key that is not 32 bytes of hex", async () => {
        await expect(
            resolveBackupKey({ override: { rawKeyHex: "not-a-key" }, verify: acceptsRightKey })
        ).rejects.toBeInstanceOf(ValidationError);
    });

    it("opens the backup with an overriding profile rather than the one it names", async () => {
        getProfileMasterKey.mockResolvedValue(RIGHT_KEY);

        const key = await resolveBackupKey({
            profileId: "named-in-metadata",
            override: { profileId: "chosen-by-user" },
            verify: acceptsRightKey,
        });

        expect(key).toEqual(RIGHT_KEY);
        expect(getProfileMasterKey).toHaveBeenCalledExactlyOnceWith("chosen-by-user");
    });

    it("asks for a key again when the picked profile is not in the Vault", async () => {
        getProfileMasterKey.mockRejectedValue(new Error("Encryption profile not found: chosen-by-user"));

        const error = await resolveBackupKey({
            profileId: "named-in-metadata",
            override: { profileId: "chosen-by-user" },
            verify: acceptsRightKey,
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(EncryptionKeyRequiredError);
        expect((error as EncryptionKeyRequiredError).profileId).toBe("named-in-metadata");
    });

    it("trusts the profile the backup names without verifying it", async () => {
        getProfileMasterKey.mockResolvedValue(WRONG_KEY);
        const verify = vi.fn(acceptsRightKey);

        const key = await resolveBackupKey({ profileId: "named", verify });

        // Verification exists to pick between candidates during recovery. Paying for it on
        // every restore would mean a read of the backup that the normal case never needs.
        expect(key).toEqual(WRONG_KEY);
        expect(verify).not.toHaveBeenCalled();
    });

    it("finds the key in another profile when the one the backup names is gone", async () => {
        getProfileMasterKey.mockImplementation(async (id: string) => {
            if (id === "deleted") throw new Error("Encryption profile not found: deleted");
            if (id === "other") return WRONG_KEY;
            if (id === "re-imported") return RIGHT_KEY;
            throw new Error("Unknown profile");
        });
        getEncryptionProfiles.mockResolvedValue([
            { id: "other", name: "Some other key" },
            { id: "re-imported", name: "The same key, imported again" },
        ]);

        const key = await resolveBackupKey({
            profileId: "deleted",
            verify: acceptsRightKey,
        });

        expect(key).toEqual(RIGHT_KEY);
    });

    it("asks for a key, naming the profile it wanted, when nothing in the vault fits", async () => {
        getProfileMasterKey.mockRejectedValue(new Error("Encryption profile not found: deleted"));
        getEncryptionProfiles.mockResolvedValue([]);

        const error = await resolveBackupKey({ profileId: "deleted", verify: acceptsRightKey })
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(EncryptionKeyRequiredError);
        expect((error as EncryptionKeyRequiredError).profileId).toBe("deleted");
        expect((error as EncryptionKeyRequiredError).code).toBe("ENCRYPTION_KEY_REQUIRED");
    });

    it("skips the vault walk when the format offers no way to test a candidate", async () => {
        getProfileMasterKey.mockRejectedValue(new Error("Encryption profile not found: deleted"));

        await expect(resolveBackupKey({ profileId: "deleted" }))
            .rejects.toBeInstanceOf(EncryptionKeyRequiredError);

        // Trying keys blind would mean handing an unverified one to the decryption pipeline.
        expect(getEncryptionProfiles).not.toHaveBeenCalled();
    });

    it("keeps walking when a candidate profile cannot be read at all", async () => {
        getProfileMasterKey.mockImplementation(async (id: string) => {
            if (id === "broken") throw new Error("Integrity Error: decrypted master key has invalid length");
            if (id === "good") return RIGHT_KEY;
            throw new Error("Encryption profile not found");
        });
        getEncryptionProfiles.mockResolvedValue([
            { id: "broken", name: "Corrupt entry" },
            { id: "good", name: "Working key" },
        ]);

        await expect(resolveBackupKey({ profileId: "deleted", verify: acceptsRightKey }))
            .resolves.toEqual(RIGHT_KEY);
    });
});

describe("archiveIndexVerifier", () => {
    const kdfSalt = crypto.randomBytes(32);
    const noncePrefix = crypto.randomBytes(4);
    const params = { kdfSalt: kdfSalt.toString("hex"), noncePrefix: noncePrefix.toString("hex") };

    /** Seals a minimal but real index with the given master key. */
    async function sealIndex(masterKey: Buffer): Promise<Buffer> {
        const { indexKey } = deriveArchiveKeys(masterKey, kdfSalt);
        return serializeIndex(
            [{ k: "h", v: 2, createdAt: "2026-07-25T20:10:37.652Z", archive: "backup.tar" }],
            { indexKey, noncePrefix }
        );
    }

    it("accepts the key the index was sealed with", async () => {
        const verify = archiveIndexVerifier(await sealIndex(RIGHT_KEY), params);
        await expect(verify(RIGHT_KEY)).resolves.toBe(true);
    });

    it("rejects any other key, because the index carries an authentication tag", async () => {
        const verify = archiveIndexVerifier(await sealIndex(RIGHT_KEY), params);
        await expect(verify(WRONG_KEY)).resolves.toBe(false);
    });

    it("rejects a key of the wrong length rather than throwing", async () => {
        const verify = archiveIndexVerifier(await sealIndex(RIGHT_KEY), params);
        await expect(verify(Buffer.alloc(16, 0x01))).resolves.toBe(false);
    });
});
