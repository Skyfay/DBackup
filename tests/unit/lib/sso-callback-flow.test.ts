// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * A callback of a provider as better-auth runs it: `handleOAuthUserInfo` finds the account by the
 * email, links it or adds someone new through the database hooks of DBackup, then starts a session.
 * The SSO plugin calls the same function after its token exchange, which the endpoint below leaves
 * out. The hooks read the accounts through Prisma, here the store better-auth writes to.
 */

interface Row extends Record<string, unknown> {
    id: string;
}

const state = vi.hoisted(() => ({
    db: { user: [], account: [], session: [], verification: [] } as Record<string, Row[]>,
    memberships: [] as { userId: string; tenantId: string; groupId: string }[],
    providers: [] as Record<string, unknown>[],
    groups: [] as { id: string; name: string; tenantId: string }[],
    log: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
    const user = (id: string) => {
        const row = state.db.user.find((entry) => entry.id === id);
        if (!row) return null;
        const memberships = state.memberships.filter((membership) => membership.userId === id).map(({ tenantId }) => ({ tenantId }));
        return { ...row, platformRole: row.platformRole ?? null, platformGroupId: row.platformGroupId ?? null, memberships };
    };
    return {
        default: {
            ssoProvider: {
                findUnique: async ({ where }: { where: { providerId: string } }) => state.providers.find((provider) => provider.providerId === where.providerId) ?? null,
                findMany: async () => state.providers.filter((provider) => provider.domain),
            },
            user: { findUnique: async ({ where }: { where: { id: string } }) => user(where.id) },
            account: {
                findFirst: async ({ where }: { where: { userId: string; providerId: string } }) =>
                    state.db.account.find((account) => account.userId === where.userId && account.providerId === where.providerId) ?? null,
            },
            session: { findUnique: async ({ where }: { where: { token: string } }) => state.db.session.find((session) => session.token === where.token) ?? null },
            tenantMembership: {
                findUnique: async ({ where }: { where: { userId_tenantId: { userId: string; tenantId: string } } }) =>
                    state.memberships.find((membership) => membership.userId === where.userId_tenantId.userId && membership.tenantId === where.userId_tenantId.tenantId) ?? null,
                create: async ({ data }: { data: { userId: string; tenantId: string; groupId: string } }) => {
                    state.memberships.push(data);
                    return data;
                },
            },
            group: { findUnique: async ({ where }: { where: { id: string } }) => state.groups.find((group) => group.id === where.id) ?? null },
        },
    };
});
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => state.log(...args) } }));

const { betterAuth } = await import("better-auth");
const { memoryAdapter } = await import("better-auth/adapters/memory");
const { createAuthEndpoint } = await import("better-auth/api");
const { handleOAuthUserInfo } = await import("better-auth/oauth2");
const { afterSsoLink, afterSsoUser, beforeSsoLink, beforeSsoSession, beforeSsoUser } = await import("@/lib/auth/sso-hooks");
const { TENANT_DOMAIN_SIGN_UP_REFUSED } = await import("@/lib/auth/sso-guard");
const { NOT_LINKED_URL, TENANT_NOT_MEMBER_URL } = await import("@/lib/auth/sso-tenant-guard");

const ACME = { providerId: "entra-acme", name: "Acme Entra ID", tenantId: "acme", domain: "acme.ch", enabled: true, allowProvisioning: true, defaultGroupId: "g-acme" };
const AUTHENTIK = { providerId: "authentik", name: "Authentik", tenantId: null, domain: null, enabled: true, allowProvisioning: true, defaultGroupId: "g-ops" };

/** What the SSO plugin does once the provider answered, without the token exchange. */
const fakeSso = {
    id: "fake-sso",
    endpoints: {
        fakeSsoCallback: createAuthEndpoint(
            "/sso/callback/:providerId",
            { method: "GET", query: z.object({ email: z.string(), sub: z.string(), signUp: z.string().optional() }) },
            async (ctx) => {
                const linked = await handleOAuthUserInfo(ctx, {
                    userInfo: { id: ctx.query.sub, email: ctx.query.email, name: ctx.query.email.split("@")[0], emailVerified: true },
                    account: { providerId: ctx.params.providerId, accountId: ctx.query.sub },
                    callbackURL: "/dashboard",
                    disableSignUp: ctx.query.signUp !== "1",
                    isTrustedProvider: false,
                    trustProviderByName: false,
                });
                if (linked.error) throw ctx.redirect(`/api/auth/error?error=${encodeURIComponent(linked.error)}`);
                return ctx.json({ userId: linked.data!.user.id });
            }
        ),
    },
};

const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-secret-of-the-test-that-is-long-enough",
    logger: { disabled: true },
    database: memoryAdapter(state.db),
    account: { accountLinking: { enabled: true, allowDifferentEmails: true } },
    // The same hooks as src/lib/auth/index.ts, which also marks every new user's email as verified.
    databaseHooks: {
        user: {
            create: {
                before: async (user, context) => {
                    await beforeSsoUser(user, context);
                    return { data: { ...user, emailVerified: true } };
                },
                after: afterSsoUser,
            },
        },
        account: { create: { before: beforeSsoLink, after: afterSsoLink } },
        session: { create: { before: async (session, context) => void (await beforeSsoSession(session, context)) } },
    },
    plugins: [fakeSso],
});

function seedUser(id: string, email: string, tenants: string[], extra: Record<string, unknown> = {}) {
    const now = new Date();
    state.db.user.push({ id, name: id, email, emailVerified: true, createdAt: now, updatedAt: now, ...extra });
    for (const tenantId of tenants) state.memberships.push({ userId: id, tenantId, groupId: `g-${tenantId}` });
}

function seedLink(userId: string, providerId: string, accountId: string) {
    const now = new Date();
    state.db.account.push({ id: `acc-${userId}-${providerId}`, userId, providerId, accountId, createdAt: now, updatedAt: now });
}

async function callback(providerId: string, email: string, sub: string, options: { signUp?: boolean; cookie?: string } = {}) {
    const query = new URLSearchParams({ email, sub, ...(options.signUp ? { signUp: "1" } : {}) });
    return auth.handler(new Request(`http://localhost:3000/api/auth/sso/callback/${providerId}?${query}`, { headers: options.cookie ? { cookie: options.cookie } : {} }));
}

const sessionsOf = (userId: string) => state.db.session.filter((session) => session.userId === userId);

describe("a callback of a provider, through the hooks of DBackup", () => {
    beforeEach(() => {
        for (const rows of Object.values(state.db)) rows.length = 0;
        state.memberships.length = 0;
        state.providers.splice(0, state.providers.length, ACME, AUTHENTIK);
        state.groups.splice(0, state.groups.length, { id: "g-acme", name: "Viewer", tenantId: "acme" }, { id: "g-ops", name: "Operators", tenantId: "default" });
    });

    it("starts no session for an account of another tenant whose link the provider of a tenant refused", async () => {
        // Bob works for Globex only, his email has the domain the admin of Acme claims for its provider.
        seedUser("bob", "bob@acme.ch", ["globex"]);

        const response = await callback("entra-acme", "bob@acme.ch", "idp-bob");

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain(TENANT_NOT_MEMBER_URL);
        expect(state.db.account).toHaveLength(0);
        expect(sessionsOf("bob")).toHaveLength(0);
    });

    it("starts no session for an account linked while it worked in the tenant, once it left", async () => {
        seedUser("bob", "bob@acme.ch", ["globex"]);
        seedLink("bob", "entra-acme", "idp-bob");

        const response = await callback("entra-acme", "bob@acme.ch", "idp-bob");

        expect(response.headers.get("location")).toContain(TENANT_NOT_MEMBER_URL);
        expect(sessionsOf("bob")).toHaveLength(0);
    });

    it("starts no session for an account a customer made whose link a provider of the platform refused", async () => {
        seedUser("lena", "lena@globex.ch", ["globex"]);

        const response = await callback("authentik", "lena@globex.ch", "idp-lena");

        expect(response.headers.get("location")).toContain(NOT_LINKED_URL);
        expect(state.db.account).toHaveLength(0);
        expect(sessionsOf("lena")).toHaveLength(0);
    });

    it("links a provider of the platform to that account for whoever signs in to it already, and signs them in", async () => {
        seedUser("lena", "lena@globex.ch", ["globex"]);
        state.db.session.push({ id: "s-lena", userId: "lena", token: "tok-lena", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date() });

        const response = await callback("authentik", "lena@globex.ch", "idp-lena", { cookie: "better-auth.session_token=tok-lena.signature" });

        expect(response.status).toBe(200);
        expect(state.db.account).toEqual([expect.objectContaining({ userId: "lena", providerId: "authentik" })]);
        expect(sessionsOf("lena")).toHaveLength(2);
    });

    it("signs in a member of the tenant through its provider, and links them on the first sign-in", async () => {
        seedUser("anna", "anna@acme.ch", ["acme"]);

        expect((await callback("entra-acme", "anna@acme.ch", "idp-anna")).status).toBe(200);
        expect(state.db.account).toEqual([expect.objectContaining({ userId: "anna", providerId: "entra-acme" })]);
        expect(sessionsOf("anna")).toHaveLength(1);

        // The next sign-in finds the link.
        expect((await callback("entra-acme", "anna@acme.ch", "idp-anna")).status).toBe(200);
        expect(sessionsOf("anna")).toHaveLength(2);
    });

    it("adds someone new through the provider of a tenant into its group, links them and signs them in", async () => {
        const response = await callback("entra-acme", "mia@acme.ch", "idp-mia", { signUp: true });

        expect(response.status).toBe(200);
        const { userId } = (await response.json()) as { userId: string };
        expect(state.memberships).toEqual([{ userId, tenantId: "acme", groupId: "g-acme" }]);
        expect(state.db.account).toEqual([expect.objectContaining({ userId, providerId: "entra-acme" })]);
        expect(sessionsOf(userId)).toHaveLength(1);
    });

    it("adds someone new through a provider of the platform into the home tenant", async () => {
        const response = await callback("authentik", "tom@example.ch", "idp-tom", { signUp: true });

        expect(response.status).toBe(200);
        const { userId } = (await response.json()) as { userId: string };
        expect(state.memberships).toEqual([{ userId, tenantId: "default", groupId: "g-ops" }]);
        expect(sessionsOf(userId)).toHaveLength(1);
    });

    it("adds nobody through a provider of the platform whose email a tenant claims for its own provider", async () => {
        const response = await callback("authentik", "mia@acme.ch", "idp-mia", { signUp: true });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain(encodeURIComponent(TENANT_DOMAIN_SIGN_UP_REFUSED));
        expect(state.db.user).toHaveLength(0);
        expect(state.db.session).toHaveLength(0);
    });
});
