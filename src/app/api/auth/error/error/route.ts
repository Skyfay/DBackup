import { NextRequest, NextResponse } from "next/server";

/**
 * Error handler for better-auth SSO errors.
 * Redirects to login page with appropriate error message.
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
    };

    const errorCode = errorMessages[error.toLowerCase()] || "sso_error";

    // Redirect to home page (login) with error parameter
    // Note: Login is on the root page ("/"), not "/login"
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("error", errorCode);

    return NextResponse.redirect(loginUrl);
}
