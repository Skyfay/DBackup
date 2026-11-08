// @vitest-environment node
/**
 * The page a link of another sign-in provider returns to. It signs the browser out only when the
 * token of the link names another account than the one the provider signed in, never for an
 * address without a token it can read, which anyone could send to end the session of whoever opens it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn(async () => undefined) }));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession, signOut: mocks.signOut } } }));
vi.stubEnv("ENCRYPTION_KEY", "c".repeat(64));

const { encrypt } = await import("@/lib/crypto");
const { GET } = await import("@/app/api/auth/sso-link-callback/route");

const plainFor = (userId: string, expiresAt = Date.now() + 60_000) => JSON.stringify({ userId, expiresAt });
const tokenFor = (userId: string, expiresAt?: number) => encodeURIComponent(encrypt(plainFor(userId, expiresAt)));
const open = (query: string) => GET(new NextRequest(`http://localhost/api/auth/sso-link-callback${query}`));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "anna" } });
});

describe("the return of a link of another sign-in provider", () => {
    it("signs out a session the provider switched to another account than the one that started the link", async () => {
        const response = await open(`?t=${tokenFor("bob")}`);
        expect(mocks.signOut).toHaveBeenCalledOnce();
        expect(response.headers.get("location")).toContain("error=sso_link_mismatch");
    });

    it("signs nobody out for an address without a token or with one it cannot read", async () => {
        for (const query of ["", "?t=", "?t=not-a-token", `?t=${encodeURIComponent(JSON.stringify({ userId: 42 }))}`]) {
            const response = await open(query);
            expect(response.headers.get("location")).toContain("error=sso_link_mismatch");
        }
        expect(mocks.signOut).not.toHaveBeenCalled();
    });

    // `decrypt` hands back a value without three `:` parts as it is, for secrets stored before encryption.
    it("signs nobody out for a token of plain JSON that names another account, with or without three colons", async () => {
        const plain = [plainFor("bob"), JSON.stringify({ userId: "bob", expiresAt: Date.now() + 60_000, pad: "a:b" }), JSON.stringify({ userId: "bob", expiresAt: Date.now() + 60_000, pad: "a:b:c" })];
        for (const token of plain) {
            const response = await open(`?t=${encodeURIComponent(token)}`);
            expect(response.headers.get("location")).toContain("error=sso_link_mismatch");
        }
        expect(mocks.signOut).not.toHaveBeenCalled();
    });

    it("keeps the own session when the token of the own account ran out", async () => {
        const response = await open(`?t=${tokenFor("anna", Date.now() - 1000)}`);
        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toContain("error=sso_link_mismatch");
    });

    it("returns to the profile when the provider signed in the account that started the link", async () => {
        const response = await open(`?t=${tokenFor("anna")}`);
        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toContain("/dashboard/profile");
    });
});
