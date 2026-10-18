// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("a page of the dashboard opened without signing in", () => {
    beforeEach(() => {
        // The rate limits of the instance cannot be fetched here, the defaults stay.
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    async function open(url: string, cookie?: string) {
        const { middleware } = await import("@/middleware");
        return middleware(new NextRequest(url, cookie ? { headers: { cookie } } : undefined));
    }

    it("sends the browser to the login page, which leads back to the page once signed in", async () => {
        const response = await open("http://localhost:3000/dashboard/jobs?open=job-1");

        expect(response.status).toBe(307);
        const location = new URL(response.headers.get("location") ?? "");
        expect(location.pathname).toBe("/");
        expect(location.searchParams.get("next")).toBe("/dashboard/jobs?open=job-1");
    });

    it("sends the bare Overview to the plain login page, which leads there with its marker", async () => {
        const response = await open("http://localhost:3000/dashboard");

        expect(new URL(response.headers.get("location") ?? "").href).toBe("http://localhost:3000/");
    });

    it("lets a request with a session through", async () => {
        const response = await open("http://localhost:3000/dashboard/jobs", "better-auth.session_token=abc");

        expect(response.headers.get("location")).toBeNull();
    });
});
