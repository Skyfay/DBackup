import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { serializeIndex } from "@/lib/archive/index-file";
import { EncryptionKeyRequiredError } from "@/lib/logging/errors";
import type { BackupMetadata } from "@/lib/core/interfaces";

vi.mock("@/lib/prisma", () => ({
    default: { adapterConfig: { findUnique: vi.fn() }, jobSource: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/core/registry", () => ({ registry: { get: vi.fn() } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));
vi.mock("@/services/backup/encryption-service", () => ({
    getProfileMasterKey: vi.fn(),
    getEncryptionProfiles: vi.fn(),
}));
const openDestination = vi.hoisted(() => vi.fn());
vi.mock("@/services/sharing/destination-access", () => ({ openDestination: (...args: unknown[]) => openDestination(...args) }));

const { ArchiveIndexService } = await import("@/services/backup/archive-index-service");
const encryptionService = await import("@/services/backup/encryption-service");

const getProfileMasterKey = encryptionService.getProfileMasterKey as ReturnType<typeof vi.fn>;
const getEncryptionProfiles = encryptionService.getEncryptionProfiles as ReturnType<typeof vi.fn>;

const MASTER_KEY = crypto.randomBytes(32);
const OTHER_KEY = crypto.randomBytes(32);
const KDF_SALT = crypto.randomBytes(32);
const NONCE_PREFIX = crypto.randomBytes(4);
const PROFILE_ID = "cmrxv45i30000wejbzdvuhv0c";

const META: BackupMetadata = {
    version: 1,
    jobId: "job-1",
    jobName: "FileBackup",
    sourceName: "Files",
    sourceType: "directory-only",
    databases: [],
    timestamp: "2026-07-25T20:11:21.000Z",
    originalFileName: "FileBackup_2026-07-25_20-11-21_inc-001.tar",
    sourceId: "src-1",
    archive: {
        formatVersion: 2,
        indexFile: ".index",
        encrypted: true,
        profileId: PROFILE_ID,
        kdfSalt: KDF_SALT.toString("hex"),
        noncePrefix: NONCE_PREFIX.toString("hex"),
    },
};

/** A real sealed index, so the service's own crypto path runs unmocked. */
async function sealedIndex(masterKey: Buffer): Promise<Buffer> {
    const { indexKey } = deriveArchiveKeys(masterKey, KDF_SALT);
    return serializeIndex(
        [{ k: "h", v: 2, createdAt: "2026-07-25T20:10:37.652Z", archive: "FileBackup_inc-001.tar" }],
        { indexKey, noncePrefix: NONCE_PREFIX }
    );
}

function makeService(sidecar: () => Promise<Buffer | null>) {
    const service = new ArchiveIndexService();
    const fetchSidecar = vi.fn(sidecar);
    vi.spyOn(service, "fetchSidecar").mockImplementation(fetchSidecar);
    return { service, fetchSidecar };
}

describe("ArchiveIndexService.load", () => {
    beforeEach(() => vi.clearAllMocks());

    it("opens the sidecar with the profile the backup names", async () => {
        getProfileMasterKey.mockResolvedValue(MASTER_KEY);
        const bytes = await sealedIndex(MASTER_KEY);
        const { service } = makeService(async () => bytes);

        const index = await service.load("dest-1", "FileBackup/inc-001.tar", META);

        expect(index?.header.archive).toBe("FileBackup_inc-001.tar");
    });

    it("recovers the index when the profile was deleted and the key re-imported", async () => {
        getProfileMasterKey.mockImplementation(async (id: string) => {
            if (id === PROFILE_ID) throw new Error(`Encryption profile not found: ${id}`);
            return MASTER_KEY;
        });
        getEncryptionProfiles.mockResolvedValue([{ id: "new-profile", name: "Re-imported" }]);
        const bytes = await sealedIndex(MASTER_KEY);
        const { service } = makeService(async () => bytes);

        await expect(service.load("dest-1", "FileBackup/inc-001.tar", META))
            .resolves.not.toBeNull();
    });

    it("asks for a key instead of pretending the index is unreadable", async () => {
        // The regression this guards: a missing profile used to be swallowed into a null,
        // which the restore page rendered as an empty backup with no explanation.
        getProfileMasterKey.mockImplementation(async (id: string) => {
            if (id === PROFILE_ID) throw new Error(`Encryption profile not found: ${id}`);
            return OTHER_KEY;
        });
        getEncryptionProfiles.mockResolvedValue([{ id: "unrelated", name: "Wrong key" }]);
        const bytes = await sealedIndex(MASTER_KEY);
        const { service } = makeService(async () => bytes);

        const error = await service.load("dest-1", "FileBackup/inc-001.tar", META).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(EncryptionKeyRequiredError);
        expect((error as EncryptionKeyRequiredError).profileId).toBe(PROFILE_ID);
    });

    it("asks for a key again when the picked key is not in the Vault, unknown or of another tenant", async () => {
        // It fell through to reading the archive as an older format, which answered 500 with
        // "Cannot read properties of undefined (reading 'map')".
        getProfileMasterKey.mockRejectedValue(new Error("Encryption profile not found: foreign"));
        const bytes = await sealedIndex(MASTER_KEY);
        const { service } = makeService(async () => bytes);

        const error = await service.summarize("dest-1", "FileBackup/inc-001.tar", META, { profileId: "foreign" }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(EncryptionKeyRequiredError);
        expect((error as EncryptionKeyRequiredError).message).toBe("The key picked to open this backup is not in the Vault.");
        expect((error as EncryptionKeyRequiredError).profileId).toBe(PROFILE_ID);
    });

    it("opens the sidecar with a key supplied by the caller", async () => {
        getProfileMasterKey.mockRejectedValue(new Error("Encryption profile not found"));
        const bytes = await sealedIndex(MASTER_KEY);
        const { service } = makeService(async () => bytes);

        const index = await service.load("dest-1", "FileBackup/inc-001.tar", META, {
            rawKeyHex: MASTER_KEY.toString("hex"),
        });

        expect(index?.header.archive).toBe("FileBackup_inc-001.tar");
    });

    it("returns null when the sidecar is not there, so the caller can try the embedded index", async () => {
        const { service } = makeService(async () => null);
        await expect(service.load("dest-1", "FileBackup/inc-001.tar", META)).resolves.toBeNull();
    });

    it("reads the sidecar once for callers that arrive together", async () => {
        getProfileMasterKey.mockResolvedValue(MASTER_KEY);
        const bytes = await sealedIndex(MASTER_KEY);
        const { service, fetchSidecar } = makeService(async () => bytes);

        // What the restore page actually does: one request per directory source plus the
        // dry run, all in flight at the same time.
        await Promise.all([
            service.load("dest-1", "FileBackup/inc-001.tar", META),
            service.load("dest-1", "FileBackup/inc-001.tar", META),
            service.load("dest-1", "FileBackup/inc-001.tar", META),
        ]);

        expect(fetchSidecar).toHaveBeenCalledOnce();
    });

    it("does not serve a failed read to the next caller", async () => {
        getProfileMasterKey.mockResolvedValue(MASTER_KEY);
        const bytes = await sealedIndex(MASTER_KEY);
        let attempt = 0;
        const { service, fetchSidecar } = makeService(async () => (attempt++ === 0 ? null : bytes));

        await expect(service.load("dest-1", "FileBackup/inc-001.tar", META)).resolves.toBeNull();
        await expect(service.load("dest-1", "FileBackup/inc-001.tar", META)).resolves.not.toBeNull();
        expect(fetchSidecar).toHaveBeenCalledTimes(2);
    });

    it("keeps a recovery attempt out of the cache", async () => {
        getProfileMasterKey.mockRejectedValue(new Error("Encryption profile not found"));
        const bytes = await sealedIndex(MASTER_KEY);
        const { service, fetchSidecar } = makeService(async () => bytes);

        await service.load("dest-1", "FileBackup/inc-001.tar", META, { rawKeyHex: MASTER_KEY.toString("hex") });
        await service.load("dest-1", "FileBackup/inc-001.tar", META, { rawKeyHex: MASTER_KEY.toString("hex") });

        // A result reached with a one-off key is not the answer a plain caller asked for.
        expect(fetchSidecar).toHaveBeenCalledTimes(2);
    });

    it("drops the index of a deleted or replaced backup in the view of every tenant", async () => {
        const { runAsTenant } = await import("@/lib/tenant/context");
        getProfileMasterKey.mockResolvedValue(MASTER_KEY);
        const bytes = await sealedIndex(MASTER_KEY);
        const { service, fetchSidecar } = makeService(async () => bytes);
        const loadAs = (tenantId: string) => runAsTenant(tenantId, () => service.load("dest-1", "FileBackup/inc-001.tar", META));

        await loadAs("acme");
        await loadAs("globex");
        service.invalidate("dest-1", "FileBackup/inc-001.tar");
        await loadAs("acme");
        await loadAs("globex");

        expect(fetchSidecar).toHaveBeenCalledTimes(4);
    });
});

describe("ArchiveIndexService.fetchSidecar", () => {
    it("reads the sidecar in the view of the tenant the path is in, which for a shared restore is not the tenant that runs", async () => {
        const download = vi.fn(async () => false);
        openDestination.mockResolvedValue({ adapter: { download }, config: {} });

        await new ArchiveIndexService().fetchSidecar("dest-1", "FileBackup/inc-001.tar", ".index", "msp");

        expect(openDestination).toHaveBeenCalledWith("dest-1", "msp");
        expect(download).toHaveBeenCalledWith({}, "FileBackup/inc-001.tar.index", expect.any(String));
    });
});
