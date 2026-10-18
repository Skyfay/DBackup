import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * Where every way of signing in leads. The Overview reads the marker once: a person who may set
 * DBackup up and has nothing to back up yet goes on to the Quick Setup, everyone else stays.
 */
export const AFTER_SIGN_IN = "/dashboard?from=sign-in";

/** The parameter of the login page that names where a sign-in leads, like `/?next=%2Finvite%3Ftoken%3D...`. */
export const NEXT_PARAM = "next";

/** A longer path is no link anyone follows. */
const NEXT_MAX_LENGTH = 2048;

/** The origin the path is read against, which never resolves, so a path that leaves it shows. */
const SITE = "http://dbackup.invalid";

/** A control character, C0 and C1, which a browser drops from an address or which splits it. */
function hasControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    }
    return false;
}

/**
 * The relative `callbackURL` better-auth takes, `isTrustedOrigin` with `allowRelativePaths`: a
 * plain path and a query of encoded values, nothing else. A target it refuses would fail the sign-in.
 */
const CALLBACK_PATH = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

/**
 * The page a sign-in may lead to, from `next` of the login page, or null. Only a path of this site
 * counts: it starts with one slash, never two, and holds no backslash and no control character,
 * since a browser reads `//host` and `/\host` as another site and drops a tab or a line break from
 * an address, which would turn `/<tab>/host` into `//host`. Starting with a slash, it names no
 * scheme. The login page, the bare Overview, which `AFTER_SIGN_IN` leads to with its marker, and the
 * API lead nowhere and give null too. The path comes back as the browser would read it, with its
 * query encoded and without its hash, in the form better-auth takes as the target of a sign-in.
 */
export function safeNextPath(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > NEXT_MAX_LENGTH) return null;
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || hasControlCharacter(value)) return null;
    let url: URL;
    try {
        url = new URL(value, SITE);
    } catch {
        return null;
    }
    if (url.origin !== SITE) return null;
    const { pathname } = url;
    if (pathname === "/" || pathname === "/api" || pathname.startsWith("/api/")) return null;
    const query = url.searchParams.toString();
    if (pathname === "/dashboard" && !query) return null;
    const path = query ? `${pathname}?${query}` : pathname;
    return CALLBACK_PATH.test(path) ? path : null;
}

/** The login page that leads back to a page after signing in, the plain login page for a path it refuses. */
export function loginHref(next: unknown): string {
    const path = safeNextPath(next);
    return path ? `/?${NEXT_PARAM}=${encodeURIComponent(path)}` : "/";
}

/** The Quick Setup adds a source, a destination and a job, so it needs the right to add all three. */
export function canUseQuickSetup(permissions: readonly string[]): boolean {
    return (
        permissions.includes(PERMISSIONS.SOURCES.WRITE) &&
        permissions.includes(PERMISSIONS.DESTINATIONS.WRITE) &&
        permissions.includes(PERMISSIONS.JOBS.WRITE)
    );
}
