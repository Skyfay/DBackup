// @vitest-environment node
/**
 * better-auth adds someone new and links them in one transaction, and with the Prisma adapter it
 * runs the after hook of the user only once the link is done. The provider of a tenant puts the
 * person it adds into its tenant in that after hook, so the link hook met them without a tenant
 * and refused them as someone another tenant made. Their first sign-in failed, see the end-to-end
 * test auth-sso-tenant.spec.ts. The link hook now puts that new user into the tenant first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    users: new Map<string, { id: string; name: string; email: string; emailVerified: boolean }>(),
    memberships: [] as { userId: string; tenantId: string; groupId: string }[],
    log: vi.fn(),
}));

const PROVIDER = { providerId: "entra-acme", name: "Acme Entra ID", tenantId: "acme", domain: "acme.ch", enabled: true, allowProvisioning: true, defaultGroupId: "group-acme" };

vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findUnique: async () => PROVIDER, findMany: async () => [PROVIDER] },
        user: {
            findUnique: async ({ where }: { where: { id: string } }) => {
                const user = state.users.get(where.id);
                if (!user) return null;
                const memberships = state.memberships.filter((membership) => membership.userId === user.id).map(({ tenantId }) => ({ tenantId }));
                return { ...user, platformRole: null, platformGroupId: null, memberships };
            },
        },
        tenantMembership: {
            findUnique: async () => null,
            create: async ({ data }: { data: { userId: string; tenantId: string; groupId: string } }) => {
                if (state.memberships.some((membership) => membership.userId === data.userId && membership.tenantId === data.tenantId)) throw new Error("Unique constraint failed");
                state.memberships.push(data);
                return data;
            },
        },
        group: { findUnique: async () => ({ id: "group-acme", name: "Viewer" }) },
        session: { findUnique: async () => null },
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => state.log(...args) } }));

const { afterSsoUser, beforeSsoLink, beforeSsoUser } = await import("@/lib/auth/sso-hooks");

const callback = () => ({ path: "/sso/callback/:providerId", params: { providerId: PROVIDER.providerId }, request: new Request("http://localhost:3000/api/auth/sso/callback/entra-acme") });

beforeEach(() => {
    state.users.clear();
    state.memberships.length = 0;
    state.log.mockClear();
});

describe("someone new through the provider of a tenant", () => {
    it("is linked although the after hook of the user runs only after the link, and joins the tenant once", async () => {
        const context = callback();
        await beforeSsoUser({ email: "Anna@acme.ch" }, context);
        state.users.set("anna", { id: "anna", name: "Anna", email: "anna@acme.ch", emailVerified: true });

        // The order of the Prisma adapter: the link, then the queued after hook of the user.
        await expect(beforeSsoLink({ userId: "anna", accountId: "idp-anna" }, context)).resolves.toBeUndefined();
        await afterSsoUser({ id: "anna", name: "Anna", email: "anna@acme.ch" }, context);

        expect(state.memberships).toEqual([{ userId: "anna", tenantId: "acme", groupId: "group-acme" }]);
        expect(state.log).toHaveBeenCalledTimes(1);
    });

    it("is placed by the after hook alone where it runs before the link", async () => {
        const context = callback();
        await beforeSsoUser({ email: "anna@acme.ch" }, context);
        state.users.set("anna", { id: "anna", name: "Anna", email: "anna@acme.ch", emailVerified: true });

        await afterSsoUser({ id: "anna", name: "Anna", email: "anna@acme.ch" }, context);
        await expect(beforeSsoLink({ userId: "anna", accountId: "idp-anna" }, context)).resolves.toBeUndefined();

        expect(state.memberships).toHaveLength(1);
    });

    it("never places an account the callback found by its email instead of adding it", async () => {
        // Bob works in no tenant, and the callback added nobody.
        state.users.set("bob", { id: "bob", name: "Bob", email: "bob@acme.ch", emailVerified: true });

        await expect(beforeSsoLink({ userId: "bob", accountId: "idp-bob" }, callback())).rejects.toThrow("account not linked");
        expect(state.memberships).toEqual([]);
    });
});
