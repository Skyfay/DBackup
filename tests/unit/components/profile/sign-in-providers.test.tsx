import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Link under Profile goes through the provider and comes back to the profile, with the reason of a
 * link the provider could not make, like an email the provider does not confirm.
 */

const mocks = vi.hoisted(() => ({
    params: new URLSearchParams(),
    replace: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    signInSso: vi.fn(async () => ({})),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: mocks.replace }),
    usePathname: () => "/dashboard/profile",
    useSearchParams: () => mocks.params,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/app/actions/auth/sso-connections", () => ({
    getMySsoConnections: vi.fn(async () => ({ connections: [], connectableProviders: [{ providerId: "pocket-id", name: "Pocket ID", adapterId: "pocket-id" }], totalAccountCount: 2 })),
    initiateSsoConnect: vi.fn(async () => ({ success: true, callbackURL: "/api/auth/sso-link-callback?t=token" })),
    unlinkMySsoAccount: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signIn: { sso: mocks.signInSso } } }));
vi.mock("@/components/oidc/provider-logo", () => ({ ProviderTile: () => null }));

const { SignInProviders } = await import("@/components/dashboard/profile/sign-in-providers");

describe("linking a provider under Profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.params = new URLSearchParams();
    });

    it("sends a link the provider cannot make back to the profile through the error route", async () => {
        render(<SignInProviders canManage />);
        await userEvent.click(await screen.findByRole("button", { name: "Link" }));

        await waitFor(() => expect(mocks.signInSso).toHaveBeenCalledWith({
            providerId: "pocket-id",
            callbackURL: "/api/auth/sso-link-callback?t=token",
            errorCallbackURL: "/api/auth/error/error?next=profile",
            requestSignUp: false,
        }));
    });

    it("says why the link failed and takes the code off the address", async () => {
        mocks.params = new URLSearchParams({ part: "security", linkError: "sso_email_unconfirmed" });
        render(<SignInProviders canManage />);

        await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Email not confirmed", expect.objectContaining({ description: expect.stringContaining("does not confirm it") })));
        expect(mocks.toast.success).not.toHaveBeenCalled();
        expect(mocks.replace).toHaveBeenCalledWith("/dashboard/profile?part=security", { scroll: false });
    });
});
