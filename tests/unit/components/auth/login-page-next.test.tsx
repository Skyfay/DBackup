import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`redirect ${to}`); }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: () => mocks.session() } } }));
vi.mock("@/services/auth/login-page-service", () => ({
    getLoginPageModel: async () => ({ instanceName: null, picture: null, adapters: [], firstStart: false, providers: [], domainRouting: false, emailLogin: true, passkeyLogin: true, autoRedirectProviderId: null }),
}));
vi.mock("@/components/auth/login-panel", () => ({ LoginLayout: ({ children }: { children: ReactElement }) => children }));
vi.mock("@/components/auth/first-start", () => ({ FirstStart: () => null }));
vi.mock("@/components/auth/login-form", () => ({ LoginForm: () => null }));

const { default: LoginPage } = await import("@/app/page");

/** The form the page renders, inside the layout of the login page. */
async function open(query: Record<string, string | string[]>) {
    const page = (await LoginPage({ searchParams: Promise.resolve(query) })) as ReactElement<{ children: ReactElement<{ next: string | null }> }>;
    return page.props.children;
}

describe("the login page with a page to go back to", () => {
    beforeEach(() => {
        mocks.session.mockReset();
    });

    it("hands the form the page of this site it names", async () => {
        mocks.session.mockResolvedValue(null);
        const form = await open({ next: "/invite?token=abc" });

        expect(form.props.next).toBe("/invite?token=abc");
    });

    it("hands the form nothing for a page of another site, which signs in to the Overview", async () => {
        mocks.session.mockResolvedValue(null);

        expect((await open({ next: "//evil.example" })).props.next).toBeNull();
        expect((await open({ next: ["/invite?token=a", "/invite?token=b"] })).props.next).toBeNull();
    });

    it("sends someone signed in already straight to the page", async () => {
        mocks.session.mockResolvedValue({ user: { id: "u1" } });

        await expect(open({ next: "/invite?token=abc" })).rejects.toThrow("redirect /invite?token=abc");
        await expect(open({ next: "https://evil.example" })).rejects.toThrow("redirect /dashboard");
    });
});
