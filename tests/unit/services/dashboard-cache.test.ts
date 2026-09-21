import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cached, invalidateDashboardCache } from "@/services/dashboard/cache";

describe("dashboard cache", () => {
    beforeEach(() => {
        invalidateDashboardCache();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("serves the stored value until it expires", async () => {
        vi.useFakeTimers();
        const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

        expect(await cached("key", 1000, load)).toBe("first");
        expect(await cached("key", 1000, load)).toBe("first");
        expect(load).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1001);
        expect(await cached("key", 1000, load)).toBe("second");
    });

    it("runs one load for concurrent callers", async () => {
        const load = vi.fn().mockResolvedValue("value");

        const results = await Promise.all([cached("key", 1000, load), cached("key", 1000, load)]);

        expect(results).toEqual(["value", "value"]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("recomputes after a finished backup invalidates it", async () => {
        const load = vi.fn().mockResolvedValueOnce("before").mockResolvedValueOnce("after");

        await cached("key", 60_000, load);
        invalidateDashboardCache();

        expect(await cached("key", 60_000, load)).toBe("after");
    });

    it("does not store a load that was already running when the cache was invalidated", async () => {
        let resolveStale: (value: string) => void = () => {};
        const stale = cached("key", 60_000, () => new Promise<string>((resolve) => { resolveStale = resolve; }));

        invalidateDashboardCache();
        resolveStale("stale");
        await stale;

        const fresh = vi.fn().mockResolvedValue("fresh");
        expect(await cached("key", 60_000, fresh)).toBe("fresh");
        expect(fresh).toHaveBeenCalledTimes(1);
    });

    it("does not cache a failed load", async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error("db locked")).mockResolvedValueOnce("value");

        await expect(cached("key", 60_000, load)).rejects.toThrow("db locked");
        expect(await cached("key", 60_000, load)).toBe("value");
    });
});
