import http from "node:http";
import https from "node:https";

/**
 * The HTTP agents of a WebDAV connection, which open a socket only to the host of its URL.
 *
 * The webdav client follows a redirect on its own and offers no option to stop it, but it asks
 * these agents for every connection, the one to the address of a redirect too. The local network
 * check of a tenant read the host of the URL, see `dialed-hosts.ts`, so a redirect to another host
 * would reach one nobody checked. A redirect on the same host, like the one a server sends for a
 * missing trailing slash, keeps working.
 */

type Connect = (options: { host?: string | null; hostname?: string | null }, callback: (error: Error | null, socket?: unknown) => void) => unknown;

/** A host as an agent gets it, without the brackets of an IPv6 address, in lower case. */
function plainHost(value: string | null | undefined): string {
    return String(value ?? "").replace(/^\[|\]$/g, "").toLowerCase();
}

/** The agent with its connections held to one host. */
function pinned<T extends http.Agent>(agent: T, host: string): T {
    const allowed = plainHost(host);
    const target = agent as unknown as { createConnection: Connect };
    const connect = target.createConnection.bind(agent);
    target.createConnection = (options, callback) => {
        const asked = plainHost(options.host ?? options.hostname);
        if (asked !== allowed) {
            process.nextTick(() => callback(new Error(`The WebDAV server sent DBackup on to ${asked}, which it does not follow. Enter the final address of the server instead.`)));
            return undefined;
        }
        return connect(options, callback);
    };
    return agent;
}

/** The agents for the webdav client of a connection whose URL names `host`. */
export function webdavAgents(host: string): { httpAgent: http.Agent; httpsAgent: https.Agent } {
    return { httpAgent: pinned(new http.Agent(), host), httpsAgent: pinned(new https.Agent(), host) };
}
