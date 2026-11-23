import { describe, expect, it } from "vitest";
import { NEXT_PARAM, loginHref, safeNextPath } from "@/lib/auth/sign-in-target";

/** The relative callbackURL better-auth 1.6 takes, from `isTrustedOrigin` with `allowRelativePaths`. */
const BETTER_AUTH_RELATIVE = /^\/(?!\/|\\|%2f|%5c)[\w\-.\+/@]*(?:\?[\w\-.\+/=&%@]*)?$/;

describe("where a sign-in leads", () => {
    it("goes to a page of this site that the login page names", () => {
        expect(safeNextPath("/invite?token=abc123")).toBe("/invite?token=abc123");
        expect(safeNextPath("/dashboard/jobs?open=job-1")).toBe("/dashboard/jobs?open=job-1");
        expect(safeNextPath("/dashboard?tenant=acme")).toBe("/dashboard?tenant=acme");
        expect(safeNextPath("/dashboard/history")).toBe("/dashboard/history");
    });

    it("reads the path as a browser would, so a dot segment cannot climb out of it", () => {
        expect(safeNextPath("/dashboard/../invite?token=abc")).toBe("/invite?token=abc");
    });

    it("hands better-auth only a target it takes, so the sign-in itself never fails on it", () => {
        expect(safeNextPath("/dashboard/history?by=manual:Manu Graf&status=Failed")).toBe("/dashboard/history?by=manual%3AManu+Graf&status=Failed");
        expect(safeNextPath("/dashboard/jobs?open=job-1#runs")).toBe("/dashboard/jobs?open=job-1");
        expect(safeNextPath("/dashboard/a~b")).toBeNull();
        for (const value of ["/invite?token=Zm9v_YmFy-123", "/dashboard/history?by=manual:Manu Graf", "/dashboard/jobs?tenant=acme&open=j1#x"]) {
            const path = safeNextPath(value);
            expect(path && BETTER_AUTH_RELATIVE.test(path), value).toBe(true);
        }
    });

    it("refuses another site, however the address is written", () => {
        for (const unsafe of [
            "//evil.example",
            "///evil.example",
            "/\\evil.example",
            "\\\\evil.example",
            "/dashboard\\..\\..\\evil",
            "https://evil.example/dashboard",
            "http:/evil.example",
            "javascript:alert(1)",
            "data:text/html,hi",
            "evil.example/dashboard",
            " /dashboard/jobs",
        ]) {
            expect(safeNextPath(unsafe), unsafe).toBeNull();
        }
    });

    it("refuses a control character, which a browser drops and which could turn the path into another site", () => {
        for (const unsafe of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/dashboard\u0000", "/dashboard\u007f", "/dashboard\u0085"]) {
            expect(safeNextPath(unsafe), JSON.stringify(unsafe)).toBeNull();
        }
    });

    it("leads nowhere new for the login page, the bare Overview and the API", () => {
        for (const value of ["/", "/?next=/dashboard/jobs", "/dashboard", "/api", "/api/settings/database/download", "/api/auth/sign-out"]) {
            expect(safeNextPath(value), value).toBeNull();
        }
    });

    it("names no page for anything else, so the sign-in goes to the Overview", () => {
        for (const value of [undefined, null, "", 42, ["/invite?token=a"], "/".padEnd(2049, "a"), "//evil.example"]) {
            expect(safeNextPath(value)).toBeNull();
        }
    });
});

describe("the address of the login page that leads back", () => {
    it("names the page in one parameter, which reads back as the same path", () => {
        const href = loginHref("/invite?token=abc&x=1");
        expect(href).toBe("/?next=%2Finvite%3Ftoken%3Dabc%26x%3D1");
        expect(new URL(href, "http://localhost").searchParams.get(NEXT_PARAM)).toBe("/invite?token=abc&x=1");
    });

    it("is the plain login page for a path it refuses", () => {
        expect(loginHref("//evil.example")).toBe("/");
        expect(loginHref("/dashboard")).toBe("/");
        expect(loginHref(null)).toBe("/");
    });
});
