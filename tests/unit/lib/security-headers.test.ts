import { afterEach, describe, expect, it, vi } from "vitest";

async function policy(env: string) {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", env);
    return (await import("@/lib/server/security-headers")).CONTENT_SECURITY_POLICY;
}

describe("the Content-Security-Policy of the pages", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("allows no eval in production and blocks plugins, foreign base URLs, form posts and framing", async () => {
        const csp = await policy("production");
        expect(csp).not.toContain("unsafe-eval");
        for (const directive of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "default-src 'self'"]) {
            expect(csp).toContain(directive);
        }
    });

    it("lets the dev server use eval for its fast refresh", async () => {
        expect(await policy("development")).toContain("'unsafe-eval'");
    });
});
