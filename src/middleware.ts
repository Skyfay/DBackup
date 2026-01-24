import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authLimiter, apiLimiter, mutationLimiter } from "./lib/rate-limit";

export async function middleware(request: NextRequest) {
    const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
    const path = request.nextUrl.pathname;
    const method = request.method;

    // Rate Limiting Logic
    try {
        if (path.startsWith("/api/auth/sign-in")) {
             // Strict limit for login endpoints
             await authLimiter.consume(ip);
        } else if (path.startsWith("/api/")) {
             // General API limit for reads
             if (method === 'GET' || method === 'HEAD') {
                await apiLimiter.consume(ip);
             } else {
                // Stricter limit for mutations (POST, PUT, DELETE, PATCH)
                await mutationLimiter.consume(ip);
             }
        }
    } catch {
        return new NextResponse("Too Many Requests", { status: 429 });
    }

    const response = NextResponse.next();

    // Add security headers to all responses
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    // Simple CSP to prevent common XSS
    response.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';"
    );
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");

    // Protect dashboard routes via cookie check (middleware layer)
    // The main protection is still in the server components (layout.tsx) via safe session verification
    if (request.nextUrl.pathname.startsWith("/dashboard")) {
        // "better-auth.session_token" is the default cookie name for better-auth
        // "better-auth.session_token.sig" might also exist
        const sessionToken = request.cookies.get("better-auth.session_token");

        // Also check if we are in a public asset that shouldn't be protected?
        // No, matcher handles excluding _next/static etc.

        if (!sessionToken) {
            return NextResponse.redirect(new URL("/", request.url));
        }
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api/auth (auth endpoints must be public)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public assets if any
         */
        '/((?!api/auth|_next/static|_next/image|favicon.ico|uploads/).*)',
    ],
};
