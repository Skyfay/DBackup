// @vitest-environment node
/**
 * The size of one dump inside a backup of a shared server, which is all a customer learns of the
 * size of a shared backup: read from the index of the archive, with the key the backup names,
 * kept once read, and only as many read at once as fit into a short time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    resolve: vi.fn(),
    meta: vi.fn(),
    load: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/archive/storage-source", () => ({ resolveStorageAdapter: mocks.resolve }));
vi.mock("@/services/restore/file-restore", () => ({ readBackupMetadata: mocks.meta }));
vi.mock("@/services/backup/archive-index-service", () => ({ archiveIndexService: { load: mocks.load } }));

const { dumpSizes, forgetDumpSizes, knownSize } = await import("@/services/tenant/shared-dump-sizes");

/** An index with the dumps of three databases, each stored in a third of its size. */
function index() {
    const databases = [
        { k: "db", name: "shop", format: "sql", n: 1, s: 3000 },
        { k: "db", name: "crm", format: "sql", n: 2, s: 6000 },
    ];
    return { databases, entries: new Map([["#1", { k: "e", n: 1, member: "d/000001", off: 0, size: 1000 }], ["#2", { k: "e", n: 2, member: "d/000002", off: 0, size: 2000 }]]) };
}

const copy = (destinationId: string, file = "Shared/feb.tar", profileId: string | null = "msp-key") => ({ destinationId, file, profileId });
const request = (id: string, databaseName = "shop", copies = [copy("nas")]) => ({ id, databaseName, copies });

beforeEach(() => {
    forgetDumpSizes();
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({ adapter: {}, config: {} });
    mocks.meta.mockResolvedValue({ archive: { formatVersion: 2 } });
    mocks.load.mockResolvedValue(index());
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the size of a shared dump", () => {
    it("is the dump of the one database, as stored and unpacked, never the archive", async () => {
        const sizes = await dumpSizes([request("b1", "crm")]);
        expect(sizes.get("b1")).toEqual({ stored: 2000, unpacked: 6000 });
    });

    it("opens the index with the key the backup names, never with a search through every key", async () => {
        await dumpSizes([request("b1")]);
        expect(mocks.load).toHaveBeenCalledWith("nas", "Shared/feb.tar", { archive: { formatVersion: 2 } }, { profileId: "msp-key" });
    });

    it("tries the next copy when one cannot be read", async () => {
        mocks.resolve.mockRejectedValueOnce(new Error("offline"));
        const sizes = await dumpSizes([request("b1", "shop", [copy("nas"), copy("s3")])]);
        expect(sizes.get("b1")).toEqual({ stored: 1000, unpacked: 3000 });
        expect(mocks.load).toHaveBeenCalledWith("s3", expect.anything(), expect.anything(), expect.anything());
    });

    it("reads a backup once and keeps what it found", async () => {
        await dumpSizes([request("b1")]);
        await dumpSizes([request("b1")]);
        expect(mocks.load).toHaveBeenCalledTimes(1);
        expect(knownSize(request("b1"))).toEqual({ stored: 1000, unpacked: 3000 });
    });

    it("has no size for a database the index does not know, and tries again later", async () => {
        const sizes = await dumpSizes([request("b1", "gone")]);
        expect(sizes.get("b1")).toBeNull();
        expect(knownSize(request("b1", "gone"))).toBeNull();
        expect(knownSize(request("b1", "gone"), Date.now() + 16 * 60_000)).toBeUndefined();
    });

    it("answers after the budget with what it read, and keeps reading the rest for the next look", async () => {
        let release: () => void = () => {};
        const slow = new Promise<void>((resolve) => { release = resolve; });
        mocks.load.mockImplementation(async (destinationId: string) => {
            if (destinationId === "slow") await slow;
            return index();
        });
        const sizes = await dumpSizes([request("fast"), request("late", "shop", [copy("slow")])], 50);
        expect(sizes.get("fast")).toEqual({ stored: 1000, unpacked: 3000 });
        expect(sizes.has("late")).toBe(false);

        release();
        await vi.waitFor(() => expect(knownSize(request("late", "shop", [copy("slow")]))).toEqual({ stored: 1000, unpacked: 3000 }));
    });
});
