/**
 * Cross-site requests to the API routes. A route signed in by the session cookie would otherwise
 * take a POST from any other site the browser visits, with SameSite=Lax as its only shield, which
 * lets a page of the same site through and depends on the browser. So a request that changes
 * something and carries the session cookie must come from DBackup itself: `Sec-Fetch-Site` says so
 * in every current browser, and the `Origin` decides where it is missing.
 *
 * Left alone: the reads, a request with an API key (a page of another site cannot set the
 * `Authorization` header without a preflight DBackup never allows), a request without the session
 * cookie, the routes of better-auth under `/api/auth`, which check the origin themselves, and a
 * client that sends neither header, which is no browser. Runs in the middleware, so it imports
 * nothing of the server.
 */

export const CROSS_SITE_REFUSED = "Cross-site request refused";

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether the cookie header holds the session of better-auth. */
function carriesSession(cookie: string | null): boolean {
    if (!cookie) return false;
    return cookie.split(";").some((part) => SESSION_COOKIES.includes(part.split("=")[0]?.trim() ?? ""));
}

/** The hosts DBackup answers on: the one the request names and those of `BETTER_AUTH_URL` and `TRUSTED_ORIGINS`. */
function ownHosts(headers: Headers): Set<string> {
    const hosts = new Set<string>();
    for (const value of [headers.get("host"), headers.get("x-forwarded-host")]) {
        for (const host of value?.split(",") ?? []) if (host.trim()) hosts.add(host.trim().toLowerCase());
    }
    const configured = [process.env.BETTER_AUTH_URL, ...(process.env.TRUSTED_ORIGINS?.split(",") ?? [])];
    for (const url of configured) {
        if (!url?.trim()) continue;
        try {
            hosts.add(new URL(url.trim()).host.toLowerCase());
        } catch {
            // Not a URL, nothing to compare with.
        }
    }
    return hosts;
}

/** Whether a request to an API route comes from another site while signed in by the session cookie. */
export function isCrossSiteRequest(method: string, pathname: string, headers: Headers): boolean {
    if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) return false;
    if (READS.has(method.toUpperCase())) return false;
    if (headers.get("authorization")?.startsWith("Bearer ")) return false;
    if (!carriesSession(headers.get("cookie"))) return false;

    const site = headers.get("sec-fetch-site");
    if (site) return site !== "same-origin" && site !== "none";

    const origin = headers.get("origin");
    if (origin === null) return false;
    if (origin === "null") return true;
    try {
        return !ownHosts(headers).has(new URL(origin).host.toLowerCase());
    } catch {
        return true;
    }
}
