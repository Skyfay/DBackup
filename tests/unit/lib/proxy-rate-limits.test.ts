// @vitest-environment node
/**
 * The limits saved in Settings > Rate limits count in the proxy. It fetched them from the server
 * itself, which failed under HTTPS with the certificate DBackup makes, so the proxy kept the
 * defaults. Now the save and the start fill the limiters of the process, which the proxy reads,
 * also from the copy of the module its own bundle holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CLIENT_ADDRESS_HEADER } from "@/lib/core/client-address";

const STATE_KEY = Symbol.for("dbackup.rateLimiters");

beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
    vi.stubEnv("DBACKUP_CUSTOM_SERVER", "1");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("the proxy fetched"); }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
});

/** Applies the limits the way a save does, in a copy of the module apart from the one of the proxy. */
async function save(auth: { points: number; duration: number }) {
    vi.resetModules();
    const { applyRateLimitConfig, RATE_LIMIT_DEFAULTS } = await import("@/lib/rate-limit");
    applyRateLimitConfig({ auth, api: { ...RATE_LIMIT_DEFAULTS.api }, mutation: { ...RATE_LIMIT_DEFAULTS.mutation } });
    vi.resetModules();
}

async function signIns(count: number, address = "198.51.100.7"): Promise<number[]> {
    const { proxy } = await import("@/proxy");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < count; attempt++) {
        const response = await proxy(new NextRequest("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { [CLIENT_ADDRESS_HEADER]: address } }));
        statuses.push(response.status);
    }
    return statuses;
}

describe("the rate limits of the settings", () => {
    it("count in the proxy once saved, lower than the default", async () => {
        await save({ points: 2, duration: 60 });

        const statuses = await signIns(3);

        expect(statuses.slice(0, 2)).not.toContain(429);
        expect(statuses[2]).toBe(429);
    });

    it("count in the proxy once saved, higher than the default", async () => {
        await save({ points: 8, duration: 60 });

        const statuses = await signIns(9);

        expect(statuses.slice(0, 8)).not.toContain(429);
        expect(statuses[8]).toBe(429);
    });

    it("are read without a request to the server itself", async () => {
        await signIns(1);

        expect(fetch).not.toHaveBeenCalled();
    });
});
