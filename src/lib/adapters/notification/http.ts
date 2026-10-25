/**
 * How the webhook style channels talk HTTP. A redirect is followed only on the host of the
 * configured URL: the local network check of a tenant read that host, see `dialed-hosts.ts`, so a
 * redirect to it again, like from `http://` to `https://` behind a proxy or to another port, goes
 * nowhere new. A redirect to another host would send the request on to a host nobody checked, so
 * it is a failed send with a message that says so.
 */

/** What every request of these channels passes to `fetch`, so a 3xx comes back as it is. */
export const NO_REDIRECTS = { redirect: "manual" } as const satisfies RequestInit;

/** How many redirects on the same host a send follows before it gives up. */
export const MAX_SAME_HOST_REDIRECTS = 5;

const isRedirect = (status: number) => status >= 300 && status <= 399;

/**
 * Sends a request of a webhook style channel and follows a redirect while it stays on the host of
 * `url`, with the same method, headers and body. Hands back the first answer that is no redirect
 * on the same host, so a redirect to another host comes back as it is, for `redirectRefusal`.
 * Throws after `MAX_SAME_HOST_REDIRECTS` redirects.
 */
export async function webhookFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const host = new URL(url).hostname.toLowerCase();
    let current = url;
    for (let hop = 0; ; hop++) {
        const response = await fetch(current, { ...init, ...NO_REDIRECTS });
        if (!isRedirect(response.status)) return response;
        const location = response.headers?.get?.("location");
        if (!location) return response;
        let next: URL;
        try {
            next = new URL(location, current);
        } catch {
            return response;
        }
        if (next.hostname.toLowerCase() !== host || (next.protocol !== "http:" && next.protocol !== "https:")) return response;
        if (hop >= MAX_SAME_HOST_REDIRECTS) throw new Error(`The address redirected more than ${MAX_SAME_HOST_REDIRECTS} times.`);
        current = next.toString();
    }
}

/** The message for a send answered with a redirect, null for any other answer. */
export function redirectRefusal(service: string, response: Pick<Response, "status" | "headers">): string | null {
    if (!isRedirect(response.status)) return null;
    const location = response.headers?.get?.("location");
    const where = location ? ` to ${location}` : "";
    return `${service} answered with a redirect${where} (${response.status}), which DBackup does not follow. Enter the final address instead.`;
}
