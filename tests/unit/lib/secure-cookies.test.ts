import { describe, expect, it } from "vitest";
import { authUrlWarning, secureCookiesFor } from "@/lib/auth/secure-cookies";

describe("secureCookiesFor", () => {
    it("sets Secure for an https address, also with DISABLE_HTTPS behind a proxy and in development", () => {
        expect(secureCookiesFor({ BETTER_AUTH_URL: "https://backup.example.com", DISABLE_HTTPS: "true", NODE_ENV: "production" })).toBe(true);
        expect(secureCookiesFor({ BETTER_AUTH_URL: "HTTPS://backup.example.com", NODE_ENV: "development" })).toBe(true);
    });

    it("sets Secure for an https:// address, and without an address while the image serves HTTPS itself", () => {
        expect(secureCookiesFor({ BETTER_AUTH_URL: "https://backup.example.com", DISABLE_HTTPS: "true", NODE_ENV: "production" })).toBe(true);
        expect(secureCookiesFor({ NODE_ENV: "production" })).toBe(true);
        expect(secureCookiesFor({ NODE_ENV: "production", DISABLE_HTTPS: "true" })).toBe(false);
    });

    it("takes an http:// address at its word, since a proxy may serve the browser plain HTTP while it speaks HTTPS to DBackup", () => {
        expect(secureCookiesFor({ BETTER_AUTH_URL: "http://backup.example.com", DISABLE_HTTPS: "false", NODE_ENV: "production" })).toBe(false);
        expect(secureCookiesFor({ BETTER_AUTH_URL: "http://192.168.1.10:3000", NODE_ENV: "production" })).toBe(false);
    });

    it("keeps plain cookies for plain HTTP, so the development server and an http proxy keep signing in", () => {
        expect(secureCookiesFor({ BETTER_AUTH_URL: "http://localhost:3000", NODE_ENV: "development" })).toBe(false);
        expect(secureCookiesFor({ NODE_ENV: "development" })).toBe(false);
        expect(secureCookiesFor({ BETTER_AUTH_URL: "http://localhost:3000", DISABLE_HTTPS: "true", NODE_ENV: "production" })).toBe(false);
        expect(secureCookiesFor({ BETTER_AUTH_URL: "http://backup.example.com", DISABLE_HTTPS: "true", NODE_ENV: "production" })).toBe(false);
    });
});

describe("authUrlWarning", () => {
    it("warns when BETTER_AUTH_URL is unset or blank", () => {
        expect(authUrlWarning({})).toMatch(/not set/);
        expect(authUrlWarning({ BETTER_AUTH_URL: "  " })).toMatch(/not set/);
    });

    it("warns about plain HTTP on a host other than localhost, whose cookies go out without Secure", () => {
        expect(authUrlWarning({ BETTER_AUTH_URL: "http://backup.example.com/", DISABLE_HTTPS: "true", NODE_ENV: "production" })).toMatch(/http:\/\/backup\.example\.com, plain HTTP.*without Secure/);
        const served = authUrlWarning({ BETTER_AUTH_URL: "http://192.168.1.10:3000", NODE_ENV: "production" });
        expect(served).toMatch(/192\.168\.1\.10:3000.*without Secure/);
    });

    it("says nothing for https, localhost, or a value that is no URL, which the schema reports", () => {
        expect(authUrlWarning({ BETTER_AUTH_URL: "https://backup.example.com" })).toBeNull();
        expect(authUrlWarning({ BETTER_AUTH_URL: "http://localhost:3000" })).toBeNull();
        expect(authUrlWarning({ BETTER_AUTH_URL: "http://127.0.0.1:3000" })).toBeNull();
        expect(authUrlWarning({ BETTER_AUTH_URL: "http://[::1]:3000" })).toBeNull();
        expect(authUrlWarning({ BETTER_AUTH_URL: "not a url" })).toBeNull();
    });
});
