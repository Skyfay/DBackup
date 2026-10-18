/**
 * How the webhook style channels talk HTTP. A redirect is never followed: the local network check
 * of a tenant read the host of the configured URL, see `dialed-hosts.ts`, and a redirect would
 * send the request on to a host nobody checked. Discord, Slack, Teams, Gotify and ntfy answer a
 * send with 2xx directly, so a redirect is a failed send with a message that says so.
 */

/** What every send of these channels passes to `fetch`, so a 3xx comes back as it is. */
export const NO_REDIRECTS = { redirect: "manual" } as const satisfies RequestInit;

/** The message for a send answered with a redirect, null for any other answer. */
export function redirectRefusal(service: string, response: Pick<Response, "status" | "headers">): string | null {
    if (response.status < 300 || response.status > 399) return null;
    const location = response.headers?.get?.("location");
    const where = location ? ` to ${location}` : "";
    return `${service} answered with a redirect${where} (${response.status}), which DBackup does not follow. Enter the final address instead.`;
}
