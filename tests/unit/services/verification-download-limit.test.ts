/**
 * A check of a destination without a checksum of its own downloads the whole backup into the
 * temporary folder every tenant shares. At most two such downloads run at once, and a backup of a
 * known size is promised its space first like a staged entry of a restore.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    download: vi.fn(),
    reserve: vi.fn(),
    release: vi.fn(),
}));

vi.mock("@/services/sharing/destination-access", () => ({
    openDestination: vi.fn(async () => ({
        adapter: { id: "sftp", download: mocks.download, upload: vi.fn(async () => true) },
        config: {},
    })),
}));
vi.mock("@/lib/adapters/storage/common/read-sidecar", () => ({
    readSidecarText: vi.fn(async () => JSON.stringify({ checksum: "abc" })),
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/crypto/checksum", () => ({ calculateFileChecksum: vi.fn(async () => "abc") }));
vi.mock("@/lib/private-temp-dir", () => ({ privateTempPath: vi.fn(async (name: string) => `/tmp/dbackup-private-test/${name}`) }));
vi.mock("@/services/restore/temp-space", () => ({ reserveTempSpace: mocks.reserve }));
vi.mock("fs/promises", () => {
    const unlink = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    return { default: { unlink, writeFile }, unlink, writeFile };
});

const { verificationService, VERIFY_SPACE_REFUSED, WHOLE_DOWNLOADS_AT_ONCE } = await import("@/services/storage/verification-service");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserve.mockResolvedValue({ release: mocks.release });
    // The note of the result in the sidecar and the cached listing is not what these tests are about.
    vi.spyOn(verificationService as unknown as { writeVerificationResult: () => Promise<void> }, "writeVerificationResult").mockResolvedValue(undefined);
});

describe("a check that downloads the whole backup", () => {
    it("runs at most two at once, the others wait their turn", async () => {
        const finishers: (() => void)[] = [];
        mocks.download.mockImplementation(() => new Promise<boolean>((resolve) => finishers.push(() => resolve(true))));

        const checks = [1, 2, 3].map((n) => verificationService.verifyFile("nas", `Nightly/${n}.tar`, "manual"));
        await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(WHOLE_DOWNLOADS_AT_ONCE));
        await tick();
        expect(mocks.download).toHaveBeenCalledTimes(2);

        finishers[0]();
        await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(3));
        finishers[1]();
        finishers[2]();
        const results = await Promise.all(checks);
        expect(results.map((result) => result.status)).toEqual(["passed", "passed", "passed"]);
    });

    it("is promised the space of a backup of known size first, and gives it back", async () => {
        mocks.download.mockResolvedValue(true);

        await verificationService.verifyFile("nas", "Nightly/1.tar", "scheduled", { size: 5_000_000 });

        expect(mocks.reserve).toHaveBeenCalledWith([5_000_000], 1);
        expect(mocks.release).toHaveBeenCalled();
    });

    it("downloads nothing when the server has not the space free", async () => {
        mocks.reserve.mockRejectedValue(new Error("no space"));

        await expect(verificationService.verifyFile("nas", "Nightly/1.tar", "manual", { size: 5_000_000_000 })).rejects.toThrow(VERIFY_SPACE_REFUSED);
        expect(mocks.download).not.toHaveBeenCalled();
    });
});
