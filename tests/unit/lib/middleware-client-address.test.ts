// @vitest-environment node
/**
 * Only the custom server replaces the header of the address. Without it, as under `next start`, a
 * client wrote the header itself, so it picks no rate limit bucket and never reaches the app or
 * better-auth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CLIENT_ADDRESS_HEADER } from "@/lib/core/client-address";

beforeEach(() => {
    vi.resetModules();
    // The rate limits of the instance cannot be fetched here, the defaults stay.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

async function send(path: string, address: string, method = "GET") {
    const { middleware } = await import("@/middleware");
    return middleware(new NextRequest(`http://localhost:3000${path}`, { method, headers: { [CLIENT_ADDRESS_HEADER]: address } }));
}

describe("the header of the address a client sends itself", () => {
    it("picks no bucket of the sign-in limit without the custom server", async () => {
        vi.stubEnv("DBACKUP_CUSTOM_SERVER", "");
        const statuses = [];
        for (let attempt = 1; attempt <= 6; attempt++) statuses.push((await send("/api/auth/sign-in/email", `198.51.100.${attempt}`, "POST")).status);
        expect(statuses.slice(0, 5)).not.toContain(429);
        expect(statuses[5]).toBe(429);
    });

    it("is dropped before the app and better-auth read it without the custom server", async () => {
        vi.stubEnv("DBACKUP_CUSTOM_SERVER", "");
        const response = await send("/api/health", "198.51.100.1");

        expect(response.headers.get("x-middleware-override-headers")?.split(",")).not.toContain(CLIENT_ADDRESS_HEADER);
        expect(response.headers.get(`x-middleware-request-${CLIENT_ADDRESS_HEADER}`)).toBeNull();
    });

    it("counts by the address the custom server set, and passes it on as it is", async () => {
        vi.stubEnv("DBACKUP_CUSTOM_SERVER", "1");
        for (let attempt = 1; attempt <= 6; attempt++) {
            expect((await send("/api/auth/sign-in/email", `203.0.113.${attempt}`, "POST")).status).not.toBe(429);
        }
        expect((await send("/api/health", "203.0.113.9")).headers.get("x-middleware-override-headers")).toBeNull();
    });
});
