/**
 * What went wrong at a sign-in, in the words of the login page. The page says it at the field or
 * on top of the step, where it stays until the next try, instead of in a message that disappears.
 */

export interface LoginProblem {
    title: string;
    text: string;
}

/** An error as better-auth hands it to `onError`. */
export interface AuthError {
    status?: number;
    code?: string;
    message?: string;
}

/** The answers a provider sends back in `?error=`, set by the sign-in hooks. */
const SSO_PROBLEMS: Record<string, LoginProblem> = {
    sso_signup_disabled: {
        title: "No account here yet",
        text: "The provider knows you, but this DBackup does not create accounts through it. An admin adds you under Users & Groups.",
    },
    sso_user_not_found: { title: "No account for this email", text: "Nobody here signs in with the email the provider sent." },
    sso_access_denied: { title: "Access denied", text: "The provider did not let you in." },
    sso_account_not_linked: {
        title: "Account not linked",
        text: "An account with this email exists, but it is not linked to this provider yet. An admin links it under Users & Groups.",
    },
    sso_link_mismatch: {
        title: "Account not connected",
        text: "This identity belongs to another account. Sign in to the provider with the email of your DBackup account, then try again.",
    },
    sso_error: { title: "Sign-in failed", text: "The provider answered with an error. Try again." },
};

export function ssoProblem(code: string): LoginProblem {
    return SSO_PROBLEMS[code] ?? SSO_PROBLEMS.sso_error;
}

const TOO_MANY = "Too many tries from here. Wait a minute and try again.";

/** Whether better-auth asks for the second factor next instead of failing. */
export function needsSecondFactor(error: AuthError): boolean {
    return error.code === "TWO_FACTOR_REQUIRED" || /2FA|two.factor/i.test(error.message ?? "");
}

/** The sentence under the password field after a sign-in failed. */
export function signInError(error: AuthError): string {
    if (error.status === 429) return TOO_MANY;
    if (error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) return "The email or the password is wrong.";
    return error.message || "The sign-in failed. Try again.";
}

/** The sentence under the code field after a second factor failed. */
export function codeError(error: AuthError, backup: boolean): string {
    if (error.status === 429) return TOO_MANY;
    if (/expired/i.test(error.code ?? "") || /expired/i.test(error.message ?? "")) return "The sign-in took too long. Go back and sign in again.";
    if (error.status === 401 || /INVALID/.test(error.code ?? "")) return backup ? "This backup code is wrong or used up." : "The code is wrong. Take the newest one of your app.";
    return error.message || "The code could not be checked. Try again.";
}

/** The provider an email belongs to by its domain, if one claims it. */
export function providerOfEmail<T extends { domain: string | null }>(providers: T[], email: string): T | undefined {
    const domain = email.trim().split("@")[1]?.toLowerCase();
    if (!domain) return undefined;
    return providers.find((provider) => provider.domain?.toLowerCase() === domain);
}
