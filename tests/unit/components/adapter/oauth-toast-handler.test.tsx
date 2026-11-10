import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { OAUTH_CALLBACK_FAILED, OAUTH_DENIED, oauthResultToast, oauthReturnUrl } from "@/lib/core/oauth-result";

const mocks = vi.hoisted(() => ({
    params: new URLSearchParams(),
    replace: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useSearchParams: () => mocks.params,
    useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

const { OAuthToastHandler } = await import("@/components/adapter/oauth-toast-handler");

/** The address the callback sent the browser to. */
function arrive(query: string) {
    mocks.params = new URLSearchParams(query);
    window.history.replaceState(null, "", `/dashboard/connections?${query}`);
}

describe("the result of an authorization on the Connections page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(window, "opener", { value: null, configurable: true });
    });

    it("comes from the callback as a fixed code and the provider, never as a sentence", () => {
        expect(oauthReturnUrl("https://dbackup.test", "dropbox", null)).toBe("https://dbackup.test/dashboard/connections?tab=destinations&oauth=success&provider=dropbox");
        expect(oauthReturnUrl("https://dbackup.test", "onedrive", "state_expired")).toBe("https://dbackup.test/dashboard/connections?tab=destinations&oauth=error&code=state_expired&provider=onedrive");
    });

    it("maps every code to a fixed sentence", () => {
        const text = (query: string) => oauthResultToast(new URLSearchParams(query));
        expect(text("oauth=success&provider=google-drive")).toEqual({ kind: "success", text: "Google Drive authorized successfully." });
        expect(text("oauth=error&code=denied&provider=dropbox")).toEqual({ kind: "error", text: OAUTH_DENIED });
        expect(text("oauth=error&code=failed")).toEqual({ kind: "error", text: OAUTH_CALLBACK_FAILED });
        expect(text("oauth=error&code=no_refresh_token&provider=google-drive")?.text).toBe("No refresh token received. Please revoke app access in your Google Account settings and try again.");
        for (const code of ["missing_code", "auth_required", "no_rights", "state_expired", "locked", "token_exchange"]) {
            expect(text(`oauth=error&code=${code}&provider=onedrive`)?.kind).toBe("error");
        }
    });

    it("ignores a code it does not know, a provider it does not know and a message of the address", () => {
        const text = (query: string) => oauthResultToast(new URLSearchParams(query));
        expect(text("oauth=error&code=toString")).toBeNull();
        expect(text("oauth=error&code=__proto__")).toBeNull();
        expect(text("oauth=error&message=Call%20support%20at%20evil.example")).toBeNull();
        expect(text("oauth=success&provider=evil&message=Hi")).toEqual({ kind: "success", text: "Authorized successfully." });
        expect(text("oauth=error&code=no_refresh_token&provider=evil")?.text).toBe("No refresh token received.");
    });

    it("shows the sentence of the code and takes the result off the address", () => {
        arrive("tab=destinations&oauth=error&code=denied&provider=dropbox&message=Call%20us");

        render(<OAuthToastHandler />);

        expect(mocks.error).toHaveBeenCalledExactlyOnceWith(OAUTH_DENIED);
        expect(mocks.replace).toHaveBeenCalledWith("/dashboard/connections?tab=destinations", { scroll: false });
    });

    it("shows nothing for a message of the address without a known code, but still cleans it up", () => {
        arrive("tab=destinations&oauth=error&message=Your%20account%20is%20locked");

        render(<OAuthToastHandler />);

        expect(mocks.error).not.toHaveBeenCalled();
        expect(mocks.success).not.toHaveBeenCalled();
        expect(mocks.replace).toHaveBeenCalledWith("/dashboard/connections?tab=destinations", { scroll: false });
    });

    it("hands the opener of a popup the fixed sentence, and nothing for an unknown code", () => {
        const postMessage = vi.fn();
        const close = vi.spyOn(window, "close").mockImplementation(() => {});
        Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });

        arrive("oauth=success&provider=onedrive&message=Hacked");
        render(<OAuthToastHandler />);
        expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "oauth_complete", status: "success", message: "OneDrive authorized successfully." }, window.location.origin);

        postMessage.mockClear();
        arrive("oauth=error&code=bogus&message=Hacked");
        render(<OAuthToastHandler />);
        expect(postMessage).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(2);
        expect(mocks.error).not.toHaveBeenCalled();
        close.mockRestore();
    });
});
