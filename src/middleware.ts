import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authLimiter, apiLimiter, mutationLimiter } from "./lib/rate-limit";
import { logger } from "./lib/logger";

const log = logger.child({ module: "Middleware" });

// Paths that should not be logged (to reduce noise)
const SILENT_PATHS = [
    "/api/health",
    "/api/auth/get-session",
];

// Determine if request should be logged
function shouldLogRequest(path: string): boolean {
    // Skip silent paths
    if (SILENT_PATHS.some(p => path.startsWith(p))) {
        return false;
    }
    // Only log API requests (not page navigations)
    return path.startsWith("/api/");
}

// Anonymize IP for privacy (keep first two octets for debugging)
function anonymizeIp(ip: string): string {
    if (ip === "127.0.0.1" || ip === "::1") return ip;
    const parts = ip.split(".");
    if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.x.x`;
    }
    // IPv6 - just show prefix
    return ip.split(":").slice(0, 2).join(":") + ":x";
}

export async function middleware(request: NextRequest) {
    const startTime = Date.now();
    const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
    const path = request.nextUrl.pathname;
    const method = request.method;
    const shouldLog = shouldLogRequest(path);

    // Rate Limiting Logic
    let rateLimitType: string | null = null;
    try {
        if (path.startsWith("/api/auth/sign-in")) {
             rateLimitType = "auth";
             await authLimiter.consume(ip);
        } else if (path.startsWith("/api/")) {
             if (method === 'GET' || method === 'HEAD') {
                rateLimitType = "api";
                await apiLimiter.consume(ip);
             } else {
                rateLimitType = "mutation";
                await mutationLimiter.consume(ip);
             }
        }
    } catch {
        // Log rate limit violation
        log.warn("Rate limit exceeded", {
            ip: anonymizeIp(ip),
            path,
            method,
            limiter: rateLimitType,
        });
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

    // Log API requests (after processing, so we know the outcome)
    if (shouldLog) {
        const duration = Date.now() - startTime;
        log.info("API request", {
            method,
            path,
            duration: `${duration}ms`,
            ip: anonymizeIp(ip),
        });
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
