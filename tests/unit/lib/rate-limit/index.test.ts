import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

import {
    RATE_LIMIT_DEFAULTS,
    RATE_LIMIT_KEYS,
    getAuthLimiter,
    getApiLimiter,
    getMutationLimiter,
    applyExternalConfig,
    type RateLimitConfig,
} from "@/lib/rate-limit";

describe("RATE_LIMIT_DEFAULTS", () => {
    it("has expected auth defaults", () => {
        expect(RATE_LIMIT_DEFAULTS.auth.points).toBe(5);
        expect(RATE_LIMIT_DEFAULTS.auth.duration).toBe(60);
    });

    it("has expected api defaults", () => {
        expect(RATE_LIMIT_DEFAULTS.api.points).toBe(100);
        expect(RATE_LIMIT_DEFAULTS.api.duration).toBe(60);
    });

    it("has expected mutation defaults", () => {
        expect(RATE_LIMIT_DEFAULTS.mutation.points).toBe(20);
        expect(RATE_LIMIT_DEFAULTS.mutation.duration).toBe(60);
    });
});

describe("RATE_LIMIT_KEYS", () => {
    it("contains expected DB setting keys", () => {
        expect(RATE_LIMIT_KEYS.authPoints).toBe("rateLimit.auth.points");
        expect(RATE_LIMIT_KEYS.authDuration).toBe("rateLimit.auth.duration");
        expect(RATE_LIMIT_KEYS.apiPoints).toBe("rateLimit.api.points");
        expect(RATE_LIMIT_KEYS.apiDuration).toBe("rateLimit.api.duration");
        expect(RATE_LIMIT_KEYS.mutationPoints).toBe("rateLimit.mutation.points");
        expect(RATE_LIMIT_KEYS.mutationDuration).toBe("rateLimit.mutation.duration");
    });
});

describe("getAuthLimiter / getApiLimiter / getMutationLimiter", () => {
    it("returns a limiter instance for auth", () => {
        const limiter = getAuthLimiter();
        expect(limiter).toBeDefined();
        expect(typeof limiter.consume).toBe("function");
    });

    it("returns a limiter instance for api", () => {
        const limiter = getApiLimiter();
        expect(limiter).toBeDefined();
        expect(typeof limiter.consume).toBe("function");
    });

    it("returns a limiter instance for mutation", () => {
        const limiter = getMutationLimiter();
        expect(limiter).toBeDefined();
        expect(typeof limiter.consume).toBe("function");
    });
});

describe("applyExternalConfig", () => {
    const newConfig: RateLimitConfig = {
        auth: { points: 10, duration: 120 },
        api: { points: 200, duration: 30 },
        mutation: { points: 50, duration: 90 },
    };

    beforeEach(() => {
        // Reset to defaults before each test
        applyExternalConfig({
            auth: { ...RATE_LIMIT_DEFAULTS.auth },
            api: { ...RATE_LIMIT_DEFAULTS.api },
            mutation: { ...RATE_LIMIT_DEFAULTS.mutation },
        });
    });

    it("rebuilds auth limiter with new points/duration", () => {
        const before = getAuthLimiter();
        applyExternalConfig(newConfig);
        const after = getAuthLimiter();
        expect(after).not.toBe(before);
        expect(after.points).toBe(10);
    });

    it("rebuilds api limiter with new points/duration", () => {
        const before = getApiLimiter();
        applyExternalConfig(newConfig);
        const after = getApiLimiter();
        expect(after).not.toBe(before);
        expect(after.points).toBe(200);
    });

    it("rebuilds mutation limiter with new points/duration", () => {
        const before = getMutationLimiter();
        applyExternalConfig(newConfig);
        const after = getMutationLimiter();
        expect(after).not.toBe(before);
        expect(after.points).toBe(50);
    });

    it("keeps a limiter and its counters when its limit did not change", async () => {
        const auth = getAuthLimiter();
        await auth.consume("203.0.113.7");

        // The middleware applies the same config every 30 seconds.
        applyExternalConfig({ ...newConfig, auth: { ...RATE_LIMIT_DEFAULTS.auth } });

        expect(getAuthLimiter()).toBe(auth);
        expect((await auth.get("203.0.113.7"))?.consumedPoints).toBe(1);
        expect(getApiLimiter().points).toBe(200);
    });
});
