// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    /** The accounts by their email. */
    accounts: new Map<string, string>([["gina@globex.example", "gina"], ["tom@acme.example", "tom"]]),
    /** The accounts the viewer sees, see `maySeeAccount`. */
    seen: new Set<string>(),
    /** The people of each tenant. */
    people: new Map<string, string[]>([["acme", ["tom"]], ["globex", ["gina"]]]),
}));

vi.mock("@/lib/prisma", () => ({
    default: { user: { findUnique: vi.fn(async ({ where }: { where: { email: string } }) => (mocks.accounts.has(where.email) ? { id: mocks.accounts.get(where.email) } : null)) } },
}));
vi.mock("@/services/user/account-visibility", () => ({ maySeeAccount: vi.fn(async (_viewer: unknown, userId: string) => mocks.seen.has(userId)) }));
vi.mock("@/services/tenant/membership-service", () => ({
    membershipService: { isPersonOf: vi.fn(async (userId: string, tenantId: string) => (mocks.people.get(tenantId) ?? []).includes(userId)) },
}));
vi.mock("@/services/tenant/invitation-service", () => ({ MAX_FAILED_SIGN_UPS: 5 }));

const { EMAIL_HAS_ACCOUNT, EMAIL_TRIES_SPENT, EMAIL_UNUSABLE, REFUSAL_WINDOW_MS, newAccountEmailRefusal, resetNewAccountEmailTries } = await import("@/services/user/new-account-email");

/** Tom, the admin of Acme, a customer, who sees the people of Acme only. */
const TOM_ADMIN = { userId: "tom-admin", tenantId: "acme", allTenants: false, isPlatformAdmin: false, permissions: ["users:write"] };
const ROOT = { userId: "root", tenantId: "default", allTenants: false, isPlatformAdmin: true, permissions: [] };
const NOW = Date.parse("2026-10-21T10:00:00.000Z");

describe("New user with an email that has an account", () => {
    beforeEach(() => {
        resetNewAccountEmailTries();
        mocks.seen = new Set();
    });

    it("never tells the admin of a customer that an email has an account in another tenant", async () => {
        const refusal = await newAccountEmailRefusal("Gina@Globex.example", TOM_ADMIN, "acme", NOW);

        expect(refusal).toBe(EMAIL_UNUSABLE);
        expect(refusal).not.toMatch(/exist|account with/i);
    });

    it("says that it exists to a platform admin, to whoever sees the account and for one of the people of the tenant", async () => {
        expect(await newAccountEmailRefusal("gina@globex.example", ROOT, "acme", NOW)).toBe(EMAIL_HAS_ACCOUNT);
        expect(await newAccountEmailRefusal("tom@acme.example", TOM_ADMIN, "acme", NOW)).toBe(EMAIL_HAS_ACCOUNT);
        mocks.seen.add("gina");
        expect(await newAccountEmailRefusal("gina@globex.example", TOM_ADMIN, "acme", NOW)).toBe(EMAIL_HAS_ACCOUNT);
    });

    it("lets a free email through", async () => {
        expect(await newAccountEmailRefusal("sara@acme.example", TOM_ADMIN, "acme", NOW)).toBeNull();
    });

    it("refuses every email for an hour after as many refusals as a link of an invitation may fail", async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
            expect(await newAccountEmailRefusal("gina@globex.example", TOM_ADMIN, "acme", NOW + attempt)).toBe(EMAIL_UNUSABLE);
        }

        // A free email too, so the answer no longer tells one address from another.
        expect(await newAccountEmailRefusal("sara@acme.example", TOM_ADMIN, "acme", NOW + 10)).toBe(EMAIL_TRIES_SPENT);
        expect(await newAccountEmailRefusal("sara@acme.example", TOM_ADMIN, "acme", NOW + REFUSAL_WINDOW_MS)).toBeNull();
    });

    it("counts no refusal of what the creator may know, and never stops a platform admin", async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
            expect(await newAccountEmailRefusal("tom@acme.example", TOM_ADMIN, "acme", NOW)).toBe(EMAIL_HAS_ACCOUNT);
            expect(await newAccountEmailRefusal("gina@globex.example", ROOT, "acme", NOW)).toBe(EMAIL_HAS_ACCOUNT);
        }
        expect(await newAccountEmailRefusal("sara@acme.example", TOM_ADMIN, "acme", NOW)).toBeNull();
    });
});
