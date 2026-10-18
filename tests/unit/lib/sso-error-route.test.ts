// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));
vi.mock("@/services/sso/email-domain-claims", () => ({ claimedEmailRefusal: vi.fn() }));

const { GET } = await import("@/app/api/auth/error/error/route");
const { TENANT_DOMAIN_SIGN_UP_REFUSED, TENANT_SIGN_UP_REFUSED } = await import("@/lib/auth/sso-guard");
const { ssoProblem } = await import("@/components/auth/login-problems");

/** The problem the login page shows after better-auth sends a refused sign-in to the error route. */
const problemAfter = async (error: string) => {
    const response = await GET(new NextRequest(`http://localhost/api/auth/error/error?error=${encodeURIComponent(error)}`));
    const code = new URL(response.headers.get("location") ?? "").searchParams.get("error") ?? "";
    return { code, problem: ssoProblem(code) };
};

describe("the login page after a sign-in a provider refused for a tenant", () => {
    it("tells someone whose email a tenant claims to sign in through the provider of that tenant", async () => {
        const { code, problem } = await problemAfter(TENANT_DOMAIN_SIGN_UP_REFUSED);

        expect(code).toBe("sso_tenant_domain");
        expect(problem.title).toBe("Your organization has its own sign-in");
    });

    it("tells someone of another domain that the provider of a tenant does not sign them in", async () => {
        const { code, problem } = await problemAfter(TENANT_SIGN_UP_REFUSED);

        expect(code).toBe("sso_tenant_refused");
        expect(problem.title).toBe("Not through this provider");
    });

    it("falls back to a general failure for an error it does not know", async () => {
        const { code, problem } = await problemAfter("something else");

        expect(code).toBe("sso_error");
        expect(problem.title).toBe("Sign-in failed");
    });
});
