import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm, SKIP_SSO_AUTO_REDIRECT_KEY } from "@/components/auth/login-form";
import { SSO_NEXT_KEY } from "@/components/auth/sign-in-next";
import type { LoginProvider } from "@/services/auth/login-page-service";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    email: vi.fn(),
    sso: vi.fn(),
    passkey: vi.fn(),
    totp: vi.fn(),
    backup: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/auth/client", () => ({
    signIn: { email: mocks.email, sso: mocks.sso, passkey: mocks.passkey },
    authClient: { twoFactor: { verifyTotp: mocks.totp, verifyBackupCode: mocks.backup } },
}));

function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (key) => data.get(key) ?? null,
        key: (index) => [...data.keys()][index] ?? null,
        removeItem: (key) => void data.delete(key),
        setItem: (key, value) => void data.set(key, String(value)),
    };
}

const authentik: LoginProvider = { id: "p1", providerId: "authentik", name: "Authentik", adapterId: "authentik", domain: "example.ch", allowProvisioning: false, host: "auth.example.ch" };
const pocket: LoginProvider = { id: "p2", providerId: "pocket", name: "Pocket ID", adapterId: "pocket-id", domain: null, allowProvisioning: true, host: "id.example.ch" };

type Props = Partial<React.ComponentProps<typeof LoginForm>>;

function renderForm(props: Props = {}) {
    render(<LoginForm instance="Production" providers={[pocket]} emailLogin passkeyLogin autoRedirectProviderId={null} {...props} />);
    return userEvent.setup();
}

/** Answers a sign-in through the fetch options the form passes, like better-auth does. */
function answer(mock: typeof mocks.email, outcome: { data?: unknown; error?: unknown }) {
    mock.mockImplementation(async ({ fetchOptions }: { fetchOptions: { onSuccess: (context: unknown) => void; onError: (context: unknown) => void } }) => {
        if (outcome.error) fetchOptions.onError({ error: outcome.error });
        else fetchOptions.onSuccess({ data: outcome.data ?? {} });
    });
}

describe("the sign-in of the login page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("sessionStorage", memoryStorage());
        mocks.sso.mockResolvedValue({ error: null });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("names the instance and asks email and password in one step while no provider claims a domain", async () => {
        const user = renderForm();
        answer(mocks.email, {});

        expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
        expect(screen.getByText("to Production")).toBeInTheDocument();
        await user.type(screen.getByLabelText("Email"), "manu@example.ch");
        await user.type(screen.getByLabelText("Password"), "correct horse");
        await user.click(screen.getByRole("button", { name: "Sign in" }));

        await waitFor(() => expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ email: "manu@example.ch", password: "correct horse" })));
        expect(mocks.push).toHaveBeenCalledWith("/dashboard?from=sign-in");
    });

    it("says a wrong password at the field instead of in a message that disappears", async () => {
        const user = renderForm();
        answer(mocks.email, { error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" } });

        await user.type(screen.getByLabelText("Email"), "manu@example.ch");
        await user.type(screen.getByLabelText("Password"), "wrong");
        await user.click(screen.getByRole("button", { name: "Sign in" }));

        expect(await screen.findByText("The email or the password is wrong.")).toBeInTheDocument();
        expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    });

    it("asks for the email first when a provider claims a domain, and its button says where it goes", async () => {
        const user = renderForm({ providers: [authentik, pocket] });

        expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
        await user.type(screen.getByLabelText("Email"), "manu@example.ch");

        expect(screen.getByText("example.ch signs in with Authentik")).toBeInTheDocument();
        // The button under the email, beside the one of the provider on top.
        const next = screen.getAllByRole("button", { name: "Continue with Authentik" }).find((button) => button.getAttribute("type") === "submit");
        await user.click(next!);
        expect(mocks.sso).toHaveBeenCalledWith(expect.objectContaining({ providerId: "authentik", requestSignUp: false }));
    });

    it("asks for the password of an email no provider claims, with a way back to the email", async () => {
        const user = renderForm({ providers: [authentik] });

        await user.type(screen.getByLabelText("Email"), "manu@other.ch");
        await user.click(screen.getByRole("button", { name: "Continue" }));

        expect(await screen.findByLabelText("Password")).toBeInTheDocument();
        expect(screen.getByText("manu@other.ch")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Change" }));
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
    });

    it("says what a provider answered on top of the step", () => {
        renderForm({ errorCode: "sso_signup_disabled" });

        expect(screen.getByRole("alert")).toHaveTextContent("No account here yet");
    });

    it("takes the code of the authenticator app after the password", async () => {
        const user = renderForm();
        answer(mocks.email, { data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] } });
        answer(mocks.totp, { error: { status: 401, code: "INVALID_CODE" } });

        await user.type(screen.getByLabelText("Email"), "manu@example.ch");
        await user.type(screen.getByLabelText("Password"), "correct horse");
        await user.click(screen.getByRole("button", { name: "Sign in" }));

        expect(await screen.findByRole("heading", { name: "Confirm it is you" })).toBeInTheDocument();
        await user.type(screen.getByLabelText("Code"), "48a2913");
        await user.click(screen.getByRole("button", { name: "Verify" }));

        expect(mocks.totp).toHaveBeenCalledWith(expect.objectContaining({ code: "482913" }));
        expect(await screen.findByText("The code is wrong. Take the newest one of your app.")).toBeInTheDocument();
    });

    it("asks for the passkey right away when it is the second factor, without a code field", async () => {
        const user = renderForm();
        answer(mocks.email, { data: { twoFactorRedirect: true, twoFactorMethods: [] } });
        mocks.passkey.mockReturnValue(new Promise(() => undefined));

        await user.type(screen.getByLabelText("Email"), "manu@example.ch");
        await user.type(screen.getByLabelText("Password"), "correct horse");
        await user.click(screen.getByRole("button", { name: "Sign in" }));

        expect(await screen.findByRole("heading", { name: "Confirm it is you" })).toBeInTheDocument();
        expect(screen.getByText("Use your passkey to finish signing in as manu@example.ch.")).toBeInTheDocument();
        expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /backup code/ })).not.toBeInTheDocument();
        await waitFor(() => expect(mocks.passkey).toHaveBeenCalledTimes(1));
    });

    it("offers the code and the passkey both when better-auth names no second factor", async () => {
        const user = renderForm();
        answer(mocks.email, { error: { status: 403, code: "TWO_FACTOR_REQUIRED" } });

        await user.type(screen.getByLabelText("Email"), "manu@example.ch");
        await user.type(screen.getByLabelText("Password"), "correct horse");
        await user.click(screen.getByRole("button", { name: "Sign in" }));

        expect(await screen.findByLabelText("Code")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Use a passkey instead" })).toBeInTheDocument();
        expect(mocks.passkey).not.toHaveBeenCalled();
    });

    it("waits for the provider of OIDC_AUTO_REDIRECT, with a way out if it does not answer", async () => {
        const reload = vi.fn();
        vi.stubGlobal("location", { ...window.location, reload });
        mocks.sso.mockReturnValue(new Promise(() => undefined));
        const user = renderForm({ providers: [authentik], autoRedirectProviderId: "authentik" });

        expect(screen.getByRole("status")).toHaveTextContent("Taking you to Authentik");
        expect(screen.getByText("auth.example.ch")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Sign in another way" }));

        expect(sessionStorage.getItem(SKIP_SSO_AUTO_REDIRECT_KEY)).toBe("1");
        expect(reload).toHaveBeenCalled();
    });

    it("stays on the form right after a sign-out instead of going back to the provider", () => {
        sessionStorage.setItem(SKIP_SSO_AUTO_REDIRECT_KEY, "1");

        renderForm({ providers: [authentik], autoRedirectProviderId: "authentik" });

        expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
        expect(mocks.sso).not.toHaveBeenCalled();
    });

    it("leaves no note when the passkey prompt was closed", async () => {
        const user = renderForm();
        mocks.passkey.mockResolvedValue({ error: { message: "The operation either timed out or was not allowed." } });

        await user.click(screen.getByRole("button", { name: "Sign in with a passkey" }));

        await waitFor(() => expect(mocks.passkey).toHaveBeenCalled());
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says how the admin gets back in when no way to sign in is left", () => {
        renderForm({ providers: [], emailLogin: false, passkeyLogin: false });

        expect(screen.getByRole("alert")).toHaveTextContent("DISABLE_EMAIL_LOGIN=false");
    });

    describe("a provider of a tenant, which only the email reaches", () => {
        const entra = { providerId: "entra-acme", name: "Acme Entra ID", adapterId: "generic", domain: "acme.ch", allowProvisioning: true };
        let lookup: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            lookup = vi.fn(async (_url: string, init: { body: string }) => {
                const { domain } = JSON.parse(init.body) as { domain: string };
                return new Response(JSON.stringify({ success: true, data: { provider: domain === "acme.ch" ? entra : null } }), { status: 200 });
            });
            vi.stubGlobal("fetch", lookup);
        });

        it("says where the email goes once it is typed and goes there, never showing the provider as a button", async () => {
            const user = renderForm({ providers: [pocket], domainRouting: true });

            expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
            await user.type(screen.getByLabelText("Email"), "lena.graf@acme.ch");

            expect(await screen.findByText("acme.ch signs in with Acme Entra ID")).toBeInTheDocument();
            const buttons = screen.getAllByRole("button", { name: "Continue with Acme Entra ID" });
            expect(buttons.map((button) => button.getAttribute("type"))).toEqual(["submit"]);
            await user.click(buttons[0]);

            await waitFor(() => expect(mocks.sso).toHaveBeenCalledWith(expect.objectContaining({ providerId: "entra-acme", requestSignUp: true, loginHint: "lena.graf@acme.ch" })));
            // The server only ever hears the domain, never the whole email.
            expect(lookup.mock.calls.every(([, init]) => JSON.parse((init as { body: string }).body).domain === "acme.ch")).toBe(true);
        });

        it("asks the server on Continue when the email was sent before it answered", async () => {
            const user = renderForm({ providers: [], domainRouting: true });

            await user.type(screen.getByLabelText("Email"), "lena.graf@acme.ch{Enter}");

            await waitFor(() => expect(mocks.sso).toHaveBeenCalledWith(expect.objectContaining({ providerId: "entra-acme" })));
        });

        it("goes on to the password for a domain no provider claims", async () => {
            const user = renderForm({ providers: [], domainRouting: true });

            await user.type(screen.getByLabelText("Email"), "manu@globex.ch");
            await user.click(screen.getByRole("button", { name: "Continue" }));

            expect(await screen.findByLabelText("Password")).toBeInTheDocument();
            expect(mocks.sso).not.toHaveBeenCalled();
        });

        it("keeps the email while passwords are off, and says when no provider takes it", async () => {
            const user = renderForm({ providers: [], domainRouting: true, emailLogin: false, passkeyLogin: false });

            expect(screen.queryByRole("alert")).not.toBeInTheDocument();
            await user.type(screen.getByLabelText("Email"), "manu@globex.ch");
            await user.click(screen.getByRole("button", { name: "Continue" }));

            expect(await screen.findByText("No sign-in provider takes this email. Sign in another way.")).toBeInTheDocument();
            expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
        });
    });

    describe("a page to go back to, like an invitation", () => {
        const invitation = "/invite?token=abc123";

        it("goes there after the password instead of the Overview", async () => {
            const user = renderForm({ next: invitation });
            answer(mocks.email, {});

            await user.type(screen.getByLabelText("Email"), "manu@example.ch");
            await user.type(screen.getByLabelText("Password"), "correct horse");
            await user.click(screen.getByRole("button", { name: "Sign in" }));

            await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(invitation));
            expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: invitation }));
        });

        it("goes there after the second factor", async () => {
            const user = renderForm({ next: invitation });
            answer(mocks.email, { data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] } });
            answer(mocks.totp, {});

            await user.type(screen.getByLabelText("Email"), "manu@example.ch");
            await user.type(screen.getByLabelText("Password"), "correct horse");
            await user.click(screen.getByRole("button", { name: "Sign in" }));
            await user.type(await screen.findByLabelText("Code"), "482913");
            await user.click(screen.getByRole("button", { name: "Verify" }));

            await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(invitation));
        });

        it("sends a provider back there and keeps it in the tab, in case the provider refuses", async () => {
            const user = renderForm({ next: invitation });

            await user.click(screen.getByRole("button", { name: "Continue with Pocket ID" }));

            await waitFor(() => expect(mocks.sso).toHaveBeenCalledWith(expect.objectContaining({ providerId: "pocket", callbackURL: invitation })));
            expect(sessionStorage.getItem(SSO_NEXT_KEY)).toBe(invitation);
        });

        it("still goes there when a provider refused and the login page came back without it", async () => {
            sessionStorage.setItem(SSO_NEXT_KEY, invitation);
            const user = renderForm({ errorCode: "sso_access_denied" });
            answer(mocks.email, {});

            await user.type(screen.getByLabelText("Email"), "manu@example.ch");
            await user.type(screen.getByLabelText("Password"), "correct horse");
            await user.click(screen.getByRole("button", { name: "Sign in" }));

            await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(invitation));
        });

        it("forgets a page of an earlier sign-in through a provider that was meant for none", async () => {
            sessionStorage.setItem(SSO_NEXT_KEY, invitation);
            const user = renderForm();

            await user.click(screen.getByRole("button", { name: "Continue with Pocket ID" }));

            await waitFor(() => expect(mocks.sso).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: "/dashboard?from=sign-in" })));
            expect(sessionStorage.getItem(SSO_NEXT_KEY)).toBeNull();
        });

        it("never takes a kept page that leads to another site", async () => {
            sessionStorage.setItem(SSO_NEXT_KEY, "//evil.example");
            const user = renderForm({ errorCode: "sso_access_denied" });
            answer(mocks.email, {});

            await user.type(screen.getByLabelText("Email"), "manu@example.ch");
            await user.type(screen.getByLabelText("Password"), "correct horse");
            await user.click(screen.getByRole("button", { name: "Sign in" }));

            await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard?from=sign-in"));
        });
    });

    it("says why a provider of a tenant turned someone away", () => {
        renderForm({ errorCode: "sso_tenant_refused" });

        expect(screen.getByRole("alert")).toHaveTextContent("Not through this provider");
    });

    it("says when a provider of a tenant signs in only its members", () => {
        renderForm({ errorCode: "sso_tenant_not_member" });

        expect(screen.getByRole("alert")).toHaveTextContent("Not a member here yet");
    });
});
