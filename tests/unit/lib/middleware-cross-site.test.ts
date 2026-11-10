// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isCrossSiteRequest } from "@/lib/server/cross-site";

const SESSION = "better-auth.session_token=abc.sig";

describe("a change through an API route signed in by the session cookie", () => {
    beforeEach(() => {
        vi.stubEnv("BETTER_AUTH_URL", "https://backup.example.ch");
        vi.stubEnv("TRUSTED_ORIGINS", "https://10.0.0.5:3000");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    const headers = (values: Record<string, string>) => new Headers({ host: "backup.example.ch", cookie: SESSION, ...values });

    it("goes through from DBackup itself", () => {
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ "sec-fetch-site": "same-origin" }))).toBe(false);
        expect(isCrossSiteRequest("DELETE", "/api/storage/s1/files", headers({ origin: "https://backup.example.ch" }))).toBe(false);
        // Another address of TRUSTED_ORIGINS, also behind a proxy that names another host.
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ host: "app:3000", origin: "https://10.0.0.5:3000" }))).toBe(false);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ host: "app:3000", "x-forwarded-host": "backup.example.ch", origin: "https://backup.example.ch" }))).toBe(false);
    });

    it("is refused from another site, also from a page of the same site and from a null origin", () => {
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }))).toBe(true);
        expect(isCrossSiteRequest("PUT", "/api/settings/x", headers({ "sec-fetch-site": "same-site", origin: "https://blog.example.ch" }))).toBe(true);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ origin: "https://evil.example" }))).toBe(true);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ origin: "null" }))).toBe(true);
        // Sec-Fetch-Site wins over an Origin that would pass.
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ "sec-fetch-site": "cross-site", origin: "https://backup.example.ch" }))).toBe(true);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ cookie: `theme=dark; __Secure-better-auth.session_token=abc`, "sec-fetch-site": "cross-site" }))).toBe(true);
    });

    it("leaves reads, API keys, requests without a session, better-auth and clients that are no browser alone", () => {
        const cross = { "sec-fetch-site": "cross-site", origin: "https://evil.example" };
        expect(isCrossSiteRequest("GET", "/api/jobs", headers(cross))).toBe(false);
        expect(isCrossSiteRequest("HEAD", "/api/jobs", headers(cross))).toBe(false);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ ...cross, authorization: "Bearer dbackup_abc" }))).toBe(false);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", new Headers(cross))).toBe(false);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({ ...cross, cookie: "better-auth.session_token_other=1" }))).toBe(false);
        expect(isCrossSiteRequest("POST", "/api/auth/sign-in/email", headers(cross))).toBe(false);
        expect(isCrossSiteRequest("POST", "/dashboard/jobs", headers(cross))).toBe(false);
        expect(isCrossSiteRequest("POST", "/api/jobs/j1/run", headers({}))).toBe(false);
    });
});

describe("the middleware", () => {
    beforeEach(() => {
        // The rate limits of the instance cannot be fetched here, the defaults stay.
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("answers a cross-site change with 403 and lets the same request from DBackup through", async () => {
        const { middleware } = await import("@/middleware");
        const refused = await middleware(new NextRequest("http://localhost:3000/api/jobs/j1/run", {
            method: "POST",
            headers: { cookie: SESSION, "sec-fetch-site": "cross-site", origin: "https://evil.example" },
        }));
        expect(refused.status).toBe(403);
        expect(await refused.json()).toEqual({ success: false, error: "Cross-site request refused" });

        const passed = await middleware(new NextRequest("http://localhost:3000/api/jobs/j1/run", {
            method: "POST",
            headers: { cookie: SESSION, "sec-fetch-site": "same-origin", origin: "http://localhost:3000" },
        }));
        expect(passed.status).toBe(200);
    });
});
