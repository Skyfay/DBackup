import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAuthLimiter, getApiLimiter, getMutationLimiter } from "./lib/rate-limit";
import { logger } from "./lib/logging/logger";
import { clientAddress, rateLimitKey, withoutClientAddress } from "./lib/core/client-address";
import { loginHref } from "./lib/auth/sign-in-target";
import { CROSS_SITE_REFUSED, isCrossSiteRequest } from "./lib/server/cross-site";
import { CONTENT_SECURITY_POLICY } from "@/lib/server/security-headers";


const log = logger.child({ module: "Proxy" });

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

/**
 * Runs before every request, in the Node.js runtime of the server process: rate limits, the
 * cross-site check, security headers and the redirect of a dashboard page without a session.
 */
export async function proxy(request: NextRequest) {
    const startTime = Date.now();
    // Set by the custom server from the socket and a trusted proxy, never by the client itself.
    // Unknown under `pnpm dev`, where every request shares one bucket.
    const ip = clientAddress(request.headers) ?? "127.0.0.1";
    const key = rateLimitKey(ip);
    const path = request.nextUrl.pathname;
    const method = request.method;
    const shouldLog = shouldLogRequest(path);

    // The limiters of the process, which the start and a save of the limits fill from the database, see `lib/rate-limit`.
    let rateLimitType: string | null = null;
    try {
        if (path.startsWith("/api/auth/sign-in")) {
             rateLimitType = "auth";
             await getAuthLimiter().consume(key);
        } else if (path === "/invite" && method === "POST") {
             // The Server Actions of an invitation, which make accounts without a session. They post
             // to the page and would otherwise pass every limiter.
             rateLimitType = "auth";
             await getAuthLimiter().consume(key);
        } else if (path.startsWith("/api/")) {
             if (method === 'GET' || method === 'HEAD') {
                rateLimitType = "api";
                await getApiLimiter().consume(key);
             } else {
                rateLimitType = "mutation";
                await getMutationLimiter().consume(key);
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

    // A change through an API route signed in by the session cookie comes from DBackup itself, see cross-site.ts.
    if (isCrossSiteRequest(method, path, request.headers)) {
        log.warn("Cross-site request refused", { ip: anonymizeIp(ip), path, method, site: request.headers.get("sec-fetch-site") ?? undefined });
        return NextResponse.json({ success: false, error: CROSS_SITE_REFUSED }, { status: 403 });
    }

    // Without the custom server a value in the header of the address came from the client, so the
    // app and better-auth never see it.
    const kept = withoutClientAddress(request.headers);
    const response = kept ? NextResponse.next({ request: { headers: kept } }) : NextResponse.next();

    // Add security headers to all responses
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");

    // HSTS: If request arrived via HTTPS (directly or via reverse proxy), enforce future HTTPS
    const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
    if (proto === "https") {
        response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    // Protect dashboard routes via cookie check (proxy layer)
    // The main protection is still in the server components (layout.tsx) via safe session verification
    if (request.nextUrl.pathname.startsWith("/dashboard")) {
        // Check both cookie names: HTTPS uses "__Secure-" prefix automatically
        const sessionToken =
            request.cookies.get("better-auth.session_token") ||
            request.cookies.get("__Secure-better-auth.session_token");

        // The login page leads back to the page asked for once someone signed in.
        if (!sessionToken) {
            return NextResponse.redirect(new URL(loginHref(`${request.nextUrl.pathname}${request.nextUrl.search}`), request.url));
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
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public assets if any
         *
         * NOTE: api/auth is intentionally NOT excluded - the proxy must
         * run on auth endpoints so the auth rate limiter (5 req/min) can
         * protect /api/auth/sign-in against brute-force attacks.
         */
        '/((?!_next/static|_next/image|favicon.ico|uploads/).*)',
    ],
};
