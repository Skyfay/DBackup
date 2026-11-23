import { NextRequest, NextResponse } from "next/server";

/**
 * Error handler for better-auth SSO errors.
 * Redirects to login page with appropriate error message.
 *
 * Public on purpose, without a permission check: better-auth redirects here when a sign-in through
 * a provider fails, before anyone is signed in. It reads nothing and changes nothing, it only maps
 * the error code of better-auth onto one of the fixed codes the login page knows. With `next=profile`,
 * set by Link under Profile, the code goes to the profile instead, see `sign-in-providers.tsx`.
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
        // better-auth links an account by its email only when the provider marks the email as
        // verified. A link DBackup refuses itself goes to the login page directly, see sso-hooks.ts.
        "account not linked": "sso_email_unconfirmed",
        "account_not_linked": "sso_email_unconfirmed",
        // A provider of a tenant refused an email of another domain, see sso-guard.ts.
        "tenant sign-in refused": "sso_tenant_refused",
        // A provider of the platform refused a new account of a domain a tenant claims, see sso-guard.ts.
        "sign in through your tenant": "sso_tenant_domain",
    };

    const errorCode = errorMessages[error.toLowerCase()] || "sso_error";

    // To the login page on the root, or back to the profile, with the code. The address is relative,
    // since the URL of the request names the address the server listens on, like 0.0.0.0:3000.
    const location = searchParams.get("next") === "profile"
        ? `/dashboard/profile?${new URLSearchParams({ part: "security", linkError: errorCode })}`
        : `/?${new URLSearchParams({ error: errorCode })}`;
    return new NextResponse(null, { status: 307, headers: { Location: location } });
}
