// @vitest-environment node
/**
 * The OAuth routes of the cloud drives answer fixed sentences. The words of a provider or of an
 * exception, which can name a host, a path or the client of the login, go to the log only, and the
 * check of a saved login runs in the tenant it belongs to, never in All tenants.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" };

const LEAK = "connect ECONNREFUSED 10.20.30.40:443 /var/lib/dbackup/secret";

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    credential: vi.fn(),
    googleToken: vi.fn(),
    dropboxAccount: vi.fn(),
    caller: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("@/lib/auth/access-control", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/auth/access-control")>()),
    getAuthContext: async () => mocks.ctx,
}));
vi.mock("@/services/auth/credential-service", () => ({
    getDecryptedCredentialData: (...args: unknown[]) => mocks.credential(...args),
    updateCredentialProfile: vi.fn(),
}));
vi.mock("googleapis", () => ({
    google: {
        auth: {
            OAuth2: class {
                setCredentials() {}
                getAccessToken() { return mocks.googleToken(); }
                getToken() { return mocks.googleToken(); }
            },
        },
    },
}));
vi.mock("dropbox", () => ({
    Dropbox: class {
        usersGetCurrentAccount() { return mocks.dropboxAccount(); }
    },
}));
vi.mock("@/lib/server/oauth-callback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/server/oauth-callback")>()),
    oauthCallbackCaller: (...args: unknown[]) => mocks.caller(...args),
    saveRefreshToken: vi.fn(),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));
vi.mock("@/services/auth/credential-audit", () => ({ credentialName: async () => "Acme drive" }));
// The saved login and its tenant, whose log keeps the entry of a check of its token.
vi.mock("@/services/audit/record-names", () => ({ credentialPlace: async () => ({ name: "Acme drive", tenantId: "t-acme" }), connectionPlace: async () => null }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { TOKEN_CHECK_FAILED } = await import("@/lib/server/oauth-callback");
const validators = {
    "google-drive": await import("@/app/api/adapters/google-drive/validate-token/route"),
    dropbox: await import("@/app/api/adapters/dropbox/validate-token/route"),
    onedrive: await import("@/app/api/adapters/onedrive/validate-token/route"),
};
const callbacks = {
    "google-drive": await import("@/app/api/adapters/google-drive/callback/route"),
    dropbox: await import("@/app/api/adapters/dropbox/callback/route"),
    onedrive: await import("@/app/api/adapters/onedrive/callback/route"),
};
const providers = Object.keys(validators) as (keyof typeof validators)[];

const member = (allTenants = false): Ctx => ({
    userId: "u-1",
    tenantId: allTenants ? null : "t-acme",
    allTenants,
    isPlatformAdmin: false,
    permissions: [PERMISSIONS.CREDENTIALS.READ],
    authMethod: "session",
});

const check = (provider: keyof typeof validators) =>
    validators[provider].POST(new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify({ credentialId: "login-1" }) }));

beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.credential.mockReset().mockResolvedValue({ clientId: "client", clientSecret: "secret", refreshToken: "refresh" });
    mocks.googleToken.mockReset().mockRejectedValue(new Error(LEAK));
    mocks.dropboxAccount.mockReset().mockRejectedValue(new Error(LEAK));
    mocks.caller.mockReset().mockResolvedValue({ ok: true, ctx: member(), credentialId: "login-1" });
    mocks.logFor.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(LEAK)));
});

describe.each(providers)("checking a saved %s login", (provider) => {
    it("answers a fixed sentence when the check broke, never the words of the error", async () => {
        mocks.ctx = member();
        const res = await check(provider);
        const body = await res.json();
        expect(body.valid).toBe(false);
        expect(body.message).toBe(TOKEN_CHECK_FAILED);
        expect(JSON.stringify(body)).not.toContain("10.20.30.40");
    });

    it("refuses All tenants without reading the login", async () => {
        mocks.ctx = { ...member(true), isPlatformAdmin: true };
        const res = await check(provider);
        expect(res.status).toBe(403);
        expect((await res.json()).valid).toBe(false);
        expect(mocks.credential).not.toHaveBeenCalled();
    });
});

describe.each(providers)("the audit log of a check of a saved %s login", (provider) => {
    const entry = (success: boolean) => [member(), "EXECUTE", "CREDENTIAL", { action: "token_check", name: "Acme drive", adapter: provider, success }, "login-1", { tenantId: "t-acme" }];

    it("notes a check the provider answered", async () => {
        mocks.ctx = member();
        mocks.googleToken.mockResolvedValue({ token: "access" });
        mocks.dropboxAccount.mockResolvedValue({ result: {} });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "access" })));

        expect((await (await check(provider)).json()).valid).toBe(true);
        expect(mocks.logFor.mock.calls).toEqual([entry(true)]);
    });

    it("notes a check that failed at the provider, never its words", async () => {
        mocks.ctx = member();
        await check(provider);
        expect(mocks.logFor.mock.calls).toEqual([entry(false)]);
    });

    it("writes nothing when the login was never sent to the provider", async () => {
        mocks.ctx = member();
        mocks.credential.mockResolvedValue({ clientId: "client", clientSecret: "secret" });
        await check(provider);
        mocks.credential.mockRejectedValue(new Error("gone"));
        await check(provider);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });
});

describe("checking a saved OneDrive login Microsoft refuses", () => {
    it("answers a fixed sentence instead of the description of Microsoft", async () => {
        mocks.ctx = member();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "invalid_client", error_description: LEAK }, { status: 401 })));
        const body = await (await check("onedrive")).json();
        expect(body).toEqual({ valid: false, message: TOKEN_CHECK_FAILED });
    });
});

describe.each(providers)("the %s callback", (provider) => {
    const callback = (query: string) => callbacks[provider].GET(new NextRequest(`http://localhost/api/adapters/${provider}/callback?${query}`));
    const shown = (res: Response) => new URL(res.headers.get("location") ?? "").searchParams;

    it("redirects with a fixed code when the exchange broke, and no sentence of its own", async () => {
        mocks.credential.mockRejectedValue(new Error(LEAK));
        const res = await callback("code=c-1&state=s-1");
        expect(shown(res).get("code")).toBe("failed");
        expect(shown(res).get("provider")).toBe(provider);
        expect(shown(res).has("message")).toBe(false);
        expect(res.headers.get("location")).not.toContain(LEAK);
    });

    it("never passes on the description a link brings along with a denial", async () => {
        const res = await callback(`error=access_denied&error_description=${encodeURIComponent("Call +1 555 0100 to unlock your account")}`);
        expect(shown(res).get("code")).toBe("denied");
        expect(res.headers.get("location")).not.toContain("555");
    });

    it("names a missing code and a refused caller by their codes", async () => {
        expect(shown(await callback("state=s-1")).get("code")).toBe("missing_code");
        mocks.caller.mockResolvedValue({ ok: false, code: "state_expired", message: "This authorization ran out or belongs to another session. Start it again from the saved login." });
        expect(shown(await callback("code=c-1&state=s-1")).get("code")).toBe("state_expired");
    });
});
