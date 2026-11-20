import { describe, expect, it } from "vitest";
import { OIDC_SCOPES, scopesOf } from "@/lib/auth/oidc-scopes";

describe("the scopes DBackup asks a sign-in provider for", () => {
    it("are openid, profile and email, without the offline_access Google refuses (#198)", () => {
        expect(OIDC_SCOPES).toEqual(["openid", "profile", "email"]);
        expect(OIDC_SCOPES).not.toContain("offline_access");
    });

    it("keep a list a stored config names", () => {
        expect(scopesOf(JSON.stringify({ scopes: ["openid", "email"] }))).toEqual(["openid", "email"]);
    });

    it("fall back to the default for a config with only the old string, no list, a broken list or no JSON", () => {
        expect(scopesOf(JSON.stringify({ scope: "openid profile email offline_access" }))).toEqual(["openid", "profile", "email"]);
        expect(scopesOf(JSON.stringify({ scopes: [] }))).toEqual(["openid", "profile", "email"]);
        expect(scopesOf(JSON.stringify({ scopes: ["openid", 5] }))).toEqual(["openid", "profile", "email"]);
        expect(scopesOf("not json")).toEqual(["openid", "profile", "email"]);
        expect(scopesOf(null)).toEqual(["openid", "profile", "email"]);
    });

    it("are a copy the caller may change without touching the default", () => {
        scopesOf(null).push("offline_access");
        expect(OIDC_SCOPES).toEqual(["openid", "profile", "email"]);
    });
});
