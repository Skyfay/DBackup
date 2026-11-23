import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerContext } from "@/lib/runner/types";

const stat = vi.hoisted(() => vi.fn());

vi.mock("fs/promises", () => ({ default: { stat }, stat }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

import { watchDumpSize } from "@/lib/runner/steps/dump-helpers";

/** A run whose every report of progress stamps its heartbeat, like the flusher of a real run does. */
function run() {
    const updateDetail = vi.fn();
    return { ctx: { updateDetail } as unknown as RunnerContext, updateDetail };
}

describe("a dump that stalls stops looking alive", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        stat.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it("reports nothing while the dump file stands still, so the stuck run check can end the run and free its slot", async () => {
        // The server sent 16 bytes and went silent with the connection open.
        stat.mockResolvedValue({ size: 16 });
        const { ctx, updateDetail } = run();
        const onBytes = vi.fn();
        const stop = watchDumpSize(ctx, "/tmp/run/dump.rdb", "dump", onBytes);

        await vi.advanceTimersByTimeAsync(10 * 60_000);
        stop();

        // The first size is progress. Every later look at the same 16 bytes is not.
        expect(updateDetail).toHaveBeenCalledTimes(1);
        expect(onBytes.mock.calls).toEqual([[16]]);
    });

    it("reports every growth of the dump file, so a long dump that still receives data stays alive", async () => {
        let size = 0;
        stat.mockImplementation(async () => ({ size: (size += 1024) }));
        const { ctx, updateDetail } = run();
        const stop = watchDumpSize(ctx, "/tmp/run/dump.sql", "shop");

        await vi.advanceTimersByTimeAsync(800 * 5);
        stop();

        expect(updateDetail).toHaveBeenCalledTimes(5);
        expect(updateDetail.mock.calls[0][0]).toContain("shop:");
    });

    it("reports again when a stalled dump moves on, and nothing for a file that is still empty or missing", async () => {
        const sizes: (number | Error)[] = [new Error("ENOENT"), 0, 16, 16, 16, 48];
        stat.mockImplementation(async () => {
            const next = sizes.shift() ?? 48;
            if (next instanceof Error) throw next;
            return { size: next };
        });
        const { ctx } = run();
        const onBytes = vi.fn();
        const stop = watchDumpSize(ctx, "/tmp/run/dump.rdb", "dump", onBytes);

        await vi.advanceTimersByTimeAsync(800 * 8);
        stop();

        expect(onBytes.mock.calls).toEqual([[16], [48]]);
    });
});
