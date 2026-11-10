/**
 * Whether a backup has to be encrypted comes from the run that wrote it, never from the files at the
 * destination, which whoever writes there can swap for a plain backup with a plain sidecar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
    execution: { findMany: vi.fn() },
    job: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const { assertEncryptionKept, EncryptionDowngradeError, recordedEncryption } = await import("@/services/restore/recorded-encryption");
const { ValidationError } = await import("@/lib/logging/errors");

const FILE = "Shop/Shop_2026-11-01.tar";

/** The metadata a run of the seekable archive keeps, see `combined-dump.ts` and `04-completion.ts`. */
function run(id: string, options: { encrypted?: boolean; destinations?: { configId: string; path?: string; status: string }[]; archive?: boolean } = {}) {
    const encrypted = options.encrypted ?? true;
    return {
        id,
        metadata: JSON.stringify({
            ...(options.archive === false ? {} : { archive: { formatVersion: 2, indexFile: ".index", encrypted, ...(encrypted ? { profileId: "key-shop" } : {}) } }),
            destinations: options.destinations ?? [{ configId: "nas", path: FILE, status: "success" }],
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.execution.findMany.mockResolvedValue([]);
    prismaMock.job.findUnique.mockResolvedValue(null);
});

describe("what the run of a backup recorded about its encryption", () => {
    it("reads it from the newest run that wrote the file to that destination", async () => {
        prismaMock.execution.findMany.mockResolvedValue([run("run-2", { encrypted: true }), run("run-1", { encrypted: false })]);

        expect(await recordedEncryption("nas", FILE)).toEqual({ encrypted: true, profileId: "key-shop", executionId: "run-2" });
        // The runner records the path without a leading slash, older runs may have one.
        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { type: "Backup", path: { in: [FILE, `/${FILE}`] } },
            orderBy: { startedAt: "desc" },
        }));
        expect(await recordedEncryption("nas", `/${FILE}`)).toEqual(expect.objectContaining({ executionId: "run-2" }));
    });

    it("knows nothing of a destination the run did not reach, an upload that failed or a run of an earlier format", async () => {
        prismaMock.execution.findMany.mockResolvedValue([
            run("other-destination", { destinations: [{ configId: "s3", path: FILE, status: "success" }] }),
            run("failed-upload", { destinations: [{ configId: "nas", path: FILE, status: "failed" }] }),
            run("v1-run", { archive: false }),
            { id: "no-metadata", metadata: null },
            { id: "broken", metadata: "{" },
        ]);

        expect(await recordedEncryption("nas", FILE)).toBeNull();
    });
});

describe("a backup that is plain where its run wrote it encrypted", () => {
    it("is refused with a sentence that names neither the key nor the job", async () => {
        prismaMock.execution.findMany.mockResolvedValue([run("run-1", { encrypted: true })]);

        const refused = assertEncryptionKept("nas", FILE, { encrypted: false, jobId: "job-1" });
        await expect(refused).rejects.toBeInstanceOf(EncryptionDowngradeError);
        await expect(assertEncryptionKept("nas", FILE, { encrypted: false })).rejects.toBeInstanceOf(ValidationError);
        await expect(assertEncryptionKept("nas", FILE, { encrypted: false })).rejects.toThrow(/written encrypted, but the file at the destination is not encrypted/);
        await expect(assertEncryptionKept("nas", FILE, { encrypted: false })).rejects.not.toThrow(/key-shop/);
    });

    it("passes an encrypted backup without asking, and a plain one whose run did not encrypt", async () => {
        await assertEncryptionKept("nas", FILE, { encrypted: true });
        expect(prismaMock.execution.findMany).not.toHaveBeenCalled();

        prismaMock.execution.findMany.mockResolvedValue([run("run-1", { encrypted: false })]);
        await expect(assertEncryptionKept("nas", FILE, { encrypted: false })).resolves.toBeUndefined();
    });

    it("reads a plain backup without a run as before, also when its job encrypts now", async () => {
        prismaMock.job.findUnique.mockResolvedValue({ encryptionProfileId: "key-shop" });

        await expect(assertEncryptionKept("nas", FILE, { encrypted: false, jobId: "job-1" })).resolves.toBeUndefined();
        expect(prismaMock.job.findUnique).toHaveBeenCalledWith({ where: { id: "job-1" }, select: { encryptionProfileId: true } });
    });
});
