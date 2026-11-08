// @vitest-environment node
/**
 * The rate limits are read by the middleware from `/api/internal/rate-limit-config`, which the
 * middleware itself never sees. It answered everyone. Now it answers only a request with the token
 * of the instance, which the middleware sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const CONFIG = { auth: { points: 5, duration: 60 }, api: { points: 100, duration: 60 }, mutation: { points: 20, duration: 60 } };

const mocks = vi.hoisted(() => ({ getRateLimitConfig: vi.fn() }));

vi.mock("@/lib/rate-limit/server", () => ({ getRateLimitConfig: mocks.getRateLimitConfig }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

const { GET } = await import("@/app/api/internal/rate-limit-config/route");
const { INTERNAL_TOKEN_HEADER, internalToken } = await import("@/lib/rate-limit/internal-token");

const SECRET = process.env.BETTER_AUTH_SECRET;
const read = (token?: string) => GET(new NextRequest("http://localhost/api/internal/rate-limit-config", { headers: token ? { [INTERNAL_TOKEN_HEADER]: token } : {} }));

beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = "a-secret-of-this-instance-for-tests";
    mocks.getRateLimitConfig.mockResolvedValue(CONFIG);
});

afterEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    vi.unstubAllGlobals();
});

describe("the rate limits for the middleware", () => {
    it("are not handed to a request from outside, with no token or a wrong one", async () => {
        const without = await read();
        const wrong = await read("0".repeat(64));

        expect([without.status, wrong.status]).toEqual([404, 404]);
        expect(mocks.getRateLimitConfig).not.toHaveBeenCalled();
    });

    it("are handed to the middleware with the token of the instance", async () => {
        const response = await read((await internalToken()) ?? undefined);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(CONFIG);
    });

    it("take a token that another instance would not, and never the secret itself", async () => {
        const mine = await internalToken();
        process.env.BETTER_AUTH_SECRET = "the-secret-of-another-instance";
        const theirs = await internalToken();

        expect(mine).toMatch(/^[0-9a-f]{64}$/);
        expect(theirs).not.toBe(mine);
        expect(mine).not.toContain("a-secret-of-this-instance");
    });

    it("are asked for by the middleware with the token", async () => {
        const fetched = vi.fn(async () => Response.json(CONFIG));
        vi.stubGlobal("fetch", fetched);
        const { middleware } = await import("@/middleware");

        await middleware(new NextRequest("http://localhost/api/jobs"));

        expect(fetched).toHaveBeenCalledOnce();
        const [url, init] = fetched.mock.calls[0] as unknown as [URL, RequestInit];
        expect(String(url)).toBe("http://localhost/api/internal/rate-limit-config");
        expect((init.headers as Record<string, string>)[INTERNAL_TOKEN_HEADER]).toBe(await internalToken());
    });
});
