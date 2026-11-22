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

vi.mock("@/lib/prisma", () => ({
    default: {
        systemSetting: {
            findMany: vi.fn(),
        },
    },
}));

// applyRateLimitConfig must be mockable to verify it is called with the right config
vi.mock("@/lib/rate-limit", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
    return {
        ...actual,
        applyRateLimitConfig: vi.fn(),
    };
});

import prisma from "@/lib/prisma";
import { applyRateLimitConfig, RATE_LIMIT_DEFAULTS, RATE_LIMIT_KEYS } from "@/lib/rate-limit";
import { reloadRateLimits, getRateLimitConfig } from "@/lib/rate-limit/server";

function makeSettings(overrides: Record<string, string> = {}) {
    const defaults: Record<string, string> = {
        [RATE_LIMIT_KEYS.authPoints]: String(RATE_LIMIT_DEFAULTS.auth.points),
        [RATE_LIMIT_KEYS.authDuration]: String(RATE_LIMIT_DEFAULTS.auth.duration),
        [RATE_LIMIT_KEYS.apiPoints]: String(RATE_LIMIT_DEFAULTS.api.points),
        [RATE_LIMIT_KEYS.apiDuration]: String(RATE_LIMIT_DEFAULTS.api.duration),
        [RATE_LIMIT_KEYS.mutationPoints]: String(RATE_LIMIT_DEFAULTS.mutation.points),
        [RATE_LIMIT_KEYS.mutationDuration]: String(RATE_LIMIT_DEFAULTS.mutation.duration),
        ...overrides,
    };
    return Object.entries(defaults).map(([key, value]) => ({ key, value }));
}

describe("reloadRateLimits", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls applyRateLimitConfig with values from DB", async () => {
        vi.mocked(prisma.systemSetting.findMany).mockResolvedValue(
            makeSettings({
                [RATE_LIMIT_KEYS.authPoints]: "10",
                [RATE_LIMIT_KEYS.authDuration]: "120",
            }) as any
        );

        await reloadRateLimits();

        expect(applyRateLimitConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                auth: { points: 10, duration: 120 },
            })
        );
    });

    it("falls back to defaults when a setting is missing", async () => {
        // Return an empty list - no settings in DB
        vi.mocked(prisma.systemSetting.findMany).mockResolvedValue([]);

        await reloadRateLimits();

        expect(applyRateLimitConfig).toHaveBeenCalledWith({
            auth: RATE_LIMIT_DEFAULTS.auth,
            api: RATE_LIMIT_DEFAULTS.api,
            mutation: RATE_LIMIT_DEFAULTS.mutation,
        });
    });

    it("falls back to defaults for NaN values", async () => {
        vi.mocked(prisma.systemSetting.findMany).mockResolvedValue(
            makeSettings({ [RATE_LIMIT_KEYS.apiPoints]: "not-a-number" }) as any
        );

        await reloadRateLimits();

        expect(applyRateLimitConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                api: expect.objectContaining({ points: RATE_LIMIT_DEFAULTS.api.points }),
            })
        );
    });

    it("falls back to defaults for values < 1", async () => {
        vi.mocked(prisma.systemSetting.findMany).mockResolvedValue(
            makeSettings({ [RATE_LIMIT_KEYS.mutationPoints]: "0" }) as any
        );

        await reloadRateLimits();

        expect(applyRateLimitConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                mutation: expect.objectContaining({ points: RATE_LIMIT_DEFAULTS.mutation.points }),
            })
        );
    });

    it("does not throw when prisma fails", async () => {
        vi.mocked(prisma.systemSetting.findMany).mockRejectedValue(new Error("DB error"));

        await expect(reloadRateLimits()).resolves.toBeUndefined();
        expect(applyRateLimitConfig).not.toHaveBeenCalled();
    });
});

describe("getRateLimitConfig", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns parsed config from DB", async () => {
        vi.mocked(prisma.systemSetting.findMany).mockResolvedValue(
            makeSettings({
                [RATE_LIMIT_KEYS.authPoints]: "3",
                [RATE_LIMIT_KEYS.apiPoints]: "50",
            }) as any
        );

        const config = await getRateLimitConfig();

        expect(config.auth.points).toBe(3);
        expect(config.api.points).toBe(50);
        expect(config.mutation.points).toBe(RATE_LIMIT_DEFAULTS.mutation.points);
    });

    it("returns defaults when DB is empty", async () => {
        vi.mocked(prisma.systemSetting.findMany).mockResolvedValue([]);

        const config = await getRateLimitConfig();

        expect(config).toEqual({
            auth: RATE_LIMIT_DEFAULTS.auth,
            api: RATE_LIMIT_DEFAULTS.api,
            mutation: RATE_LIMIT_DEFAULTS.mutation,
        });
    });

    it("returns defaults when prisma throws", async () => {
        vi.mocked(prisma.systemSetting.findMany).mockRejectedValue(new Error("DB unavailable"));

        const config = await getRateLimitConfig();

        expect(config).toEqual({ ...RATE_LIMIT_DEFAULTS });
    });
});
