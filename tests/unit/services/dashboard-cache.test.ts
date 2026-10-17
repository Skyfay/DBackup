import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAsSystem, runAsTenant, type TenantScope } from "@/lib/tenant/context";
import { cached, invalidateDashboardCache } from "@/services/dashboard/cache";

// The scope the request being handled names through its session, none outside a request.
const request = vi.hoisted(() => ({ scope: null as TenantScope | null }));
vi.mock("@/lib/tenant/current", () => ({ requestScope: async () => request.scope }));

describe("dashboard cache", () => {
    beforeEach(() => {
        invalidateDashboardCache();
        request.scope = null;
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
        let started: () => void = () => {};
        const running = new Promise<void>((resolve) => { started = resolve; });
        const stale = cached("key", 60_000, () => new Promise<string>((resolve) => { resolveStale = resolve; started(); }));
        await running;

        invalidateDashboardCache();
        resolveStale("stale");
        await stale;

        const fresh = vi.fn().mockResolvedValue("fresh");
        expect(await cached("key", 60_000, fresh)).toBe("fresh");
        expect(fresh).toHaveBeenCalledTimes(1);
    });

    it("keeps entries marked to survive a finished backup, such as past calendar days", async () => {
        const load = vi.fn().mockResolvedValue("past days");

        await cached("calendar-history:survives", 60_000, load, { survivesInvalidation: true });
        invalidateDashboardCache();

        expect(await cached("calendar-history:survives", 60_000, load, { survivesInvalidation: true })).toBe("past days");
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("never serves a request of an account of no tenant what was cached for every tenant", async () => {
        await runAsSystem(() => cached("aggregates", 60_000, async () => "every tenant"));

        const ownLoad = vi.fn().mockResolvedValue("nothing");
        expect(await cached("aggregates", 60_000, ownLoad)).toBe("nothing");
        expect(ownLoad).toHaveBeenCalledTimes(1);
    });

    it("shares the entries of every tenant between the system scope and All tenants, and keeps each tenant apart", async () => {
        await runAsSystem(() => cached("aggregates", 60_000, async () => "every tenant"));

        request.scope = { kind: "all" };
        const allLoad = vi.fn().mockResolvedValue("loaded again");
        expect(await cached("aggregates", 60_000, allLoad)).toBe("every tenant");
        expect(allLoad).not.toHaveBeenCalled();

        expect(await runAsTenant("acme", () => cached("aggregates", 60_000, async () => "acme"))).toBe("acme");
        request.scope = { kind: "tenant", tenantId: "acme" };
        expect(await cached("aggregates", 60_000, async () => "loaded again")).toBe("acme");
    });

    it("does not cache a failed load", async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error("db locked")).mockResolvedValueOnce("value");

        await expect(cached("key", 60_000, load)).rejects.toThrow("db locked");
        expect(await cached("key", 60_000, load)).toBe("value");
    });
});
