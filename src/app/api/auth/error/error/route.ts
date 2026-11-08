import { NextRequest, NextResponse } from "next/server";

/**
 * Error handler for better-auth SSO errors.
 * Redirects to login page with appropriate error message.
 *
 * Public on purpose, without a permission check: better-auth redirects here when a sign-in through
 * a provider fails, before anyone is signed in. It reads nothing and changes nothing, it only maps
 * the error code of better-auth onto one of the fixed codes the login page knows.
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const error = searchParams.get("error") || "unknown_error";

    // Map known errors to user-friendly messages
    const errorMessages: Record<string, string> = {
        "signup disabled": "sso_signup_disabled",
        "signup_disabled": "sso_signup_disabled",
        "user_not_found": "sso_user_not_found",
        "access_denied": "sso_access_denied",
        "account not linked": "sso_account_not_linked",
        "account_not_linked": "sso_account_not_linked",
        // A provider of a tenant refused an email of another domain, see sso-guard.ts.
        "tenant sign-in refused": "sso_tenant_refused",
        // A provider of the platform refused a new account of a domain a tenant claims, see sso-guard.ts.
        "sign in through your tenant": "sso_tenant_domain",
    };

    const errorCode = errorMessages[error.toLowerCase()] || "sso_error";

    // Redirect to home page (login) with error parameter
    // Note: Login is on the root page ("/"), not "/login"
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("error", errorCode);

    return NextResponse.redirect(loginUrl);
}
