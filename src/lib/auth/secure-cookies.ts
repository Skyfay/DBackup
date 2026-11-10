/**
 * Whether the cookies of better-auth carry `Secure` and the `__Secure-` prefix. Left to itself
 * better-auth sets them only when its base URL starts with https://, so behind a proxy that
 * encrypts the way to the browser, with BETTER_AUTH_URL unset or http://, the session cookie went
 * out without them. The middleware and `getSessionCookie` read both names, so either works.
 */

/** The variables this reads, `process.env` in the app. */
export interface SecureCookieEnv {
    BETTER_AUTH_URL?: string;
    DISABLE_HTTPS?: string;
    NODE_ENV?: string;
}

const isHttps = (url: string | undefined) => /^https:\/\//i.test(url?.trim() ?? "");

/**
 * True when the browser reaches DBackup over HTTPS: BETTER_AUTH_URL starts with https://, or it is
 * unset and the server of the image serves HTTPS itself, which it does unless DISABLE_HTTPS is
 * "true". An http:// address is taken at its word, since a proxy may speak HTTPS to DBackup while
 * the browser speaks plain HTTP to the proxy, where a Secure cookie would be dropped. The start warns
 * about that address, see `authUrlWarning`. `next dev` serves plain HTTP whatever DISABLE_HTTPS
 * says, so the development server keeps plain cookies.
 */
export function secureCookiesFor(env: SecureCookieEnv): boolean {
    const url = env.BETTER_AUTH_URL?.trim();
    if (url) return isHttps(url);
    return env.NODE_ENV === "production" && env.DISABLE_HTTPS !== "true";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * What the start of DBackup warns about BETTER_AUTH_URL, null when nothing. Unset, the redirects and
 * the trusted origin are http://localhost:3000. An http:// address of another host means the cookies
 * go out without `Secure` while DISABLE_HTTPS is "true", also behind a proxy that serves HTTPS.
 */
export function authUrlWarning(env: SecureCookieEnv): string | null {
    const value = env.BETTER_AUTH_URL?.trim();
    if (!value) {
        return "BETTER_AUTH_URL is not set, so DBackup assumes http://localhost:3000. Set it to the address people open in the browser, like https://backup.example.com.";
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        // env-validation reports an address that is no URL.
        return null;
    }
    if (url.protocol !== "http:" || LOCAL_HOSTS.has(url.hostname.toLowerCase())) return null;
    const cookies = secureCookiesFor(env) ? "" : " The session cookie goes out without Secure.";
    return `BETTER_AUTH_URL is ${url.origin}, plain HTTP on a host other than localhost.${cookies} Behind a proxy that serves HTTPS, set it to the https:// address people open.`;
}
