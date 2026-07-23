import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "@/lib/concurrency";

/** A deferred promise plus its resolver, for controlling task completion order in a test. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {
    it("never runs more than the limit at once", async () => {
        let inFlight = 0;
        let peak = 0;
        const items = Array.from({ length: 20 }, (_, i) => i);

        await mapWithConcurrency(items, 4, async (n) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return n;
        });

        expect(peak).toBe(4);
    });

    it("keeps results in input order regardless of completion order", async () => {
        // The last item resolves first, the first item last - order must still hold.
        const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
        const promise = mapWithConcurrency([0, 1, 2], 3, (n) => gates[n].promise);

        gates[2].resolve(22);
        gates[0].resolve(0);
        gates[1].resolve(11);

        expect(await promise).toEqual([0, 11, 22]);
    });

    it("runs strictly sequentially at limit 1", async () => {
        const order: string[] = [];
        await mapWithConcurrency([0, 1, 2], 1, async (n) => {
            order.push(`start-${n}`);
            await new Promise((r) => setTimeout(r, 1));
            order.push(`end-${n}`);
            return n;
        });

        // Never overlaps: each item ends before the next starts.
        expect(order).toEqual(["start-0", "end-0", "start-1", "end-1", "start-2", "end-2"]);
    });

    it("rejects on the first failing item", async () => {
        await expect(
            mapWithConcurrency([1, 2, 3], 2, async (n) => {
                if (n === 2) throw new Error("boom");
                return n;
            })
        ).rejects.toThrow("boom");
    });

    it("handles an empty list", async () => {
        expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
    });

    it("passes the index to the worker", async () => {
        const seen = await mapWithConcurrency(["a", "b", "c"], 2, async (item, i) => `${i}:${item}`);
        expect(seen).toEqual(["0:a", "1:b", "2:c"]);
    });
});
