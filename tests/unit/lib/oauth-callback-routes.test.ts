// @vitest-environment node
/**
 * The authorization of a cloud storage login (Dropbox, Google Drive, OneDrive). The provider hands
 * `state` back to the callback as it got it. It used to be the id of the login, so anyone signed in
 * could send a code of their own account to the login of another tenant. Now it is a nonce the auth
 * route binds to the person, the tenant and the login, both routes need the right to change saved
 * logins, and the new token is in the audit log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" | "apikey" };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    getCredential: vi.fn(),
    updateCredential: vi.fn(),
    logFor: vi.fn(),
    fetch: vi.fn(),
    getToken: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => {
    const has = (ctx: Ctx, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission);
    return {
        getAuthContext: async () => mocks.ctx,
        hasPermissionWithContext: has,
        checkPermissionWithContext: (ctx: Ctx, permission: string) => {
            if (!has(ctx, permission)) throw new PermissionError(permission);
        },
        tenantOf: (ctx: Ctx) => {
            if (!ctx.tenantId) throw new PermissionError("a tenant");
            return ctx.tenantId;
        },
    };
});
vi.mock("@/services/auth/credential-service", () => ({
    getDecryptedCredentialData: (...args: unknown[]) => mocks.getCredential(...args),
    updateCredentialProfile: (...args: unknown[]) => mocks.updateCredential(...args),
}));
vi.mock("@/services/auth/credential-audit", () => ({
    credentialSnapshot: async () => ({ name: "Acme Dropbox", values: {} }),
    credentialChanges: () => [{ field: "Refresh token", from: null, to: null, secret: true }],
}));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));
vi.mock("dropbox", () => ({
    DropboxAuth: class {
        async getAuthenticationUrl(redirectUri: string, state: string) {
            return `https://www.dropbox.com/oauth2/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
        }
    },
}));
vi.mock("googleapis", () => ({
    google: {
        auth: {
            OAuth2: class {
                generateAuthUrl(options: { state: string }) {
                    return `https://accounts.google.com/o/oauth2/auth?state=${encodeURIComponent(options.state)}`;
                }
                getToken(code: string) {
                    return mocks.getToken(code);
                }
            },
        },
    },
}));
vi.stubGlobal("fetch", (...args: unknown[]) => mocks.fetch(...args));

const routes = {
    dropbox: { auth: await import("@/app/api/adapters/dropbox/auth/route"), callback: await import("@/app/api/adapters/dropbox/callback/route") },
    "google-drive": { auth: await import("@/app/api/adapters/google-drive/auth/route"), callback: await import("@/app/api/adapters/google-drive/callback/route") },
    onedrive: { auth: await import("@/app/api/adapters/onedrive/auth/route"), callback: await import("@/app/api/adapters/onedrive/callback/route") },
};
const { consumeOAuthState, createOAuthState } = await import("@/lib/auth/oauth-state");

const ORIGIN = "https://dbackup.test";
const admin = (tenantId = "acme", userId = "lena"): Ctx => ({ userId, tenantId, allTenants: false, isPlatformAdmin: false, permissions: [PERMISSIONS.CREDENTIALS.WRITE], authMethod: "session" });

const startAuth = (provider: keyof typeof routes, credentialId = "cred-acme") =>
    routes[provider].auth.POST(new NextRequest(`${ORIGIN}/api/adapters/${provider}/auth`, { method: "POST", body: JSON.stringify({ credentialId }) }));
const stateOf = async (response: Response) => new URL((await response.json()).data.authUrl).searchParams.get("state")!;
const callback = (provider: keyof typeof routes, state: string) =>
    routes[provider].callback.GET(new NextRequest(`${ORIGIN}/api/adapters/${provider}/callback?code=the-code&state=${encodeURIComponent(state)}`));
const outcomeOf = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("oauth");

describe.each(["dropbox", "google-drive", "onedrive"] as const)("the authorization of a %s login", (provider) => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
        mocks.ctx = admin();
        mocks.getCredential.mockResolvedValue({ clientId: "client", clientSecret: "secret" });
        mocks.updateCredential.mockResolvedValue({ id: "cred-acme", name: "Acme Dropbox" });
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ refresh_token: "new-refresh-token" }), { status: 200 }));
        mocks.getToken.mockResolvedValue({ tokens: { refresh_token: "new-refresh-token" } });
    });

    it("hands the provider a state that does not name the login", async () => {
        const state = await stateOf(await startAuth(provider));

        expect(state).not.toBe("cred-acme");
        expect(state.length).toBeGreaterThan(30);
    });

    it("keeps the token in the login the authorization was started for and notes the change", async () => {
        const state = await stateOf(await startAuth(provider));

        const response = await callback(provider, state);

        expect(outcomeOf(response)).toBe("success");
        expect(mocks.updateCredential).toHaveBeenCalledWith("cred-acme", { data: { clientId: "client", clientSecret: "secret", refreshToken: "new-refresh-token" } });
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "CREDENTIAL", { name: "Acme Dropbox", changes: [{ field: "Refresh token", from: null, to: null, secret: true }] }, "cred-acme");
    });

    it("writes nothing for a state that is the id of a login, as the callback took it before", async () => {
        const response = await callback(provider, "cred-other-tenant");

        expect(outcomeOf(response)).toBe("error");
        expect(mocks.updateCredential).not.toHaveBeenCalled();
    });

    it("writes nothing when someone else, or the same person in another tenant, brings the state back", async () => {
        const state = await stateOf(await startAuth(provider));

        mocks.ctx = admin("acme", "mallory");
        expect(outcomeOf(await callback(provider, state))).toBe("error");
        mocks.ctx = admin("globex");
        expect(outcomeOf(await callback(provider, state))).toBe("error");
        expect(mocks.updateCredential).not.toHaveBeenCalled();

        // The state is still there for the one it was made for, once.
        mocks.ctx = admin();
        expect(outcomeOf(await callback(provider, state))).toBe("success");
        expect(outcomeOf(await callback(provider, state))).toBe("error");
        expect(mocks.updateCredential).toHaveBeenCalledTimes(1);
    });

    it("needs the right to change saved logins in both routes, from a signed-in person", async () => {
        const state = await stateOf(await startAuth(provider));

        mocks.ctx = { ...admin(), permissions: [PERMISSIONS.CREDENTIALS.READ] };
        expect((await startAuth(provider)).status).toBe(403);
        expect(outcomeOf(await callback(provider, state))).toBe("error");

        mocks.ctx = { ...admin(), authMethod: "apikey" };
        expect(outcomeOf(await callback(provider, state))).toBe("error");

        mocks.ctx = null;
        expect(outcomeOf(await callback(provider, state))).toBe("error");
        expect(mocks.updateCredential).not.toHaveBeenCalled();
    });

    it("starts none in All tenants", async () => {
        mocks.ctx = { ...admin(), tenantId: null, allTenants: true, isPlatformAdmin: true };

        expect((await startAuth(provider)).status).toBe(403);
        expect(mocks.getCredential).not.toHaveBeenCalled();
    });
});

describe("the state of an authorization", () => {
    it("runs out", () => {
        vi.useFakeTimers();
        try {
            const state = createOAuthState({ provider: "onedrive", userId: "lena", tenantId: "acme", credentialId: "cred-acme" });
            vi.advanceTimersByTime(16 * 60 * 1000);
            expect(consumeOAuthState(state, { provider: "onedrive", userId: "lena", tenantId: "acme" })).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("belongs to the provider it was made for", () => {
        const state = createOAuthState({ provider: "dropbox", userId: "lena", tenantId: "acme", credentialId: "cred-acme" });

        expect(consumeOAuthState(state, { provider: "onedrive", userId: "lena", tenantId: "acme" })).toBeNull();
        expect(consumeOAuthState(state, { provider: "dropbox", userId: "lena", tenantId: "acme" })).toEqual({ credentialId: "cred-acme" });
    });
});
