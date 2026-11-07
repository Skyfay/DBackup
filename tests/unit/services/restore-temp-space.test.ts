import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs/promises";
import { ServiceError } from "@/lib/logging/errors";
import { promisedTempSpace, reserveTempSpace, stagedAtOnce, TEMP_SPACE_RESERVE, type TempSpaceReservation } from "@/services/restore/temp-space";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const GB = 1024 * 1024 * 1024;

/** A temporary folder with `free` bytes left. */
function freeSpace(free: number) {
    return vi.spyOn(fs, "statfs").mockResolvedValue({ bavail: free / 4096, bsize: 4096 } as Awaited<ReturnType<typeof fs.statfs>>);
}

/** Reserves and gives the space back at once, for a check of one restore alone. */
async function fits(sizes: number[], atOnce: number): Promise<true> {
    (await reserveTempSpace(sizes, atOnce, "/tmp")).release();
    return true;
}

const held: TempSpaceReservation[] = [];

afterEach(() => {
    for (const reservation of held.splice(0)) reservation.release();
    vi.restoreAllMocks();
});

describe("the temporary space of a restore", () => {
    it("counts what lies there at once, the largest entries as many as run together", () => {
        expect(stagedAtOnce([5, 100, 20, 7], 1)).toBe(100);
        expect(stagedAtOnce([5, 100, 20, 7], 2)).toBe(120);
        expect(stagedAtOnce([5, 100, 20, 7], 10)).toBe(132);
        expect(stagedAtOnce([], 4)).toBe(0);
    });

    it("refuses a backup whose entries declare more than the folder has free, before anything is written", async () => {
        freeSpace(10 * GB);
        // A few bytes of Brotli may declare a terabyte, and the reader would inflate to it.
        await expect(reserveTempSpace([1024 * GB], 1, "/tmp")).rejects.toBeInstanceOf(ServiceError);
        await expect(reserveTempSpace([1024 * GB], 1, "/tmp")).rejects.toThrow(/more than the server has free/);
        expect(promisedTempSpace()).toBe(0);
    });

    it("keeps the reserve free", async () => {
        freeSpace(4 * GB);
        await expect(reserveTempSpace([4 * GB - TEMP_SPACE_RESERVE + 1], 1, "/tmp")).rejects.toBeInstanceOf(ServiceError);
        await expect(fits([4 * GB - TEMP_SPACE_RESERVE], 1)).resolves.toBe(true);
    });

    it("lets a large restore through that stages its files one by one", async () => {
        freeSpace(10 * GB);
        // A thousand files of 1 GB each are a terabyte in all, but only four lie there at a time.
        await expect(fits(new Array(1000).fill(GB), 4)).resolves.toBe(true);
    });

    it("refuses nothing where the free space cannot be read", async () => {
        vi.spyOn(fs, "statfs").mockRejectedValue(new Error("ENOSYS"));
        await expect(fits([1024 * GB], 1)).resolves.toBe(true);
        expect(promisedTempSpace()).toBe(0);
    });
});

describe("restores that run at once", () => {
    it("never count the same free space twice", async () => {
        // Each of them fits alone, the second not beside the first, which has written nothing yet.
        freeSpace(6 * GB);
        held.push(await reserveTempSpace([3 * GB], 1, "/tmp"));
        expect(promisedTempSpace()).toBe(3 * GB);

        await expect(reserveTempSpace([3 * GB], 1, "/tmp")).rejects.toBeInstanceOf(ServiceError);
    });

    it("get the space back once a restore ends, also when it failed, and only once", async () => {
        freeSpace(6 * GB);
        const first = await reserveTempSpace([3 * GB], 1, "/tmp");
        try {
            throw new Error("the restore failed");
        } catch {
            // What the callers do in their finally.
        } finally {
            first.release();
        }
        first.release();
        expect(promisedTempSpace()).toBe(0);

        held.push(await reserveTempSpace([3 * GB], 1, "/tmp"));
        expect(promisedTempSpace()).toBe(3 * GB);
    });

    it("are checked one after the other even when they ask at the same moment", async () => {
        freeSpace(6 * GB);
        const results = await Promise.allSettled([reserveTempSpace([3 * GB], 1, "/tmp"), reserveTempSpace([3 * GB], 1, "/tmp")]);
        for (const result of results) if (result.status === "fulfilled") held.push(result.value);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });
});
