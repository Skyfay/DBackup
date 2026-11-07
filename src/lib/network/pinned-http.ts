import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

import { assertLiteralReachable, checkedLookup } from "./reach-check";
import type { ReachPolicy } from "./reach-policy";

/**
 * HTTP for a connection of a tenant that blocks the local network, with every address checked at
 * connect time, see `reach-check.ts`: agents of `node:http` for clients that take one, like the
 * webdav client and the S3 SDK, and `pinnedFetch` for the notification channels, which talk
 * `fetch`. The global `fetch` takes no agent and no `lookup`, so `pinnedFetch` sends the request
 * through such an agent instead and hands back a `Response`.
 *
 * The agents keep the name of the URL for the `Host` header, the TLS server name and the check of
 * the certificate, and only the address they dial comes from the checked lookup.
 */

type Connect = (options: http.ClientRequestArgs, callback: (error: Error | null, socket?: unknown) => void) => unknown;

/** Holds every connection of an agent to checked addresses. Mutates and returns the agent. */
export function guardAgent<T extends http.Agent>(agent: T, reach: ReachPolicy): T {
    const lookup = checkedLookup(reach.allowed);
    const target = agent as unknown as { createConnection: Connect };
    const connect = target.createConnection.bind(agent);
    target.createConnection = (options, callback) => {
        // `net` dials an address literal without a lookup, so it is checked here.
        try {
            assertLiteralReachable(String(options.host ?? options.hostname ?? ""), reach.allowed);
        } catch (error: unknown) {
            process.nextTick(() => callback(error as Error));
            return undefined;
        }
        return connect({ ...options, lookup }, callback);
    };
    return agent;
}

/**
 * An http and an https agent with checked addresses, see `guardAgent`. `keepAlive` keeps sockets
 * open between requests, as the agents of the S3 SDK do by default, with its 50 sockets per host.
 */
export function guardedAgents(reach: ReachPolicy, options: { keepAlive?: boolean } = {}): { httpAgent: http.Agent; httpsAgent: https.Agent } {
    const settings = options.keepAlive ? { keepAlive: true, maxSockets: 50 } : {};
    return { httpAgent: guardAgent(new http.Agent(settings), reach), httpsAgent: guardAgent(new https.Agent(settings), reach) };
}

/** Statuses whose answer has no body, which `Response` refuses one for. */
const NO_BODY = new Set([101, 204, 205, 304]);

/** The timeouts of `fetch` (undici): to connect, until the headers of the answer, and between two chunks of its body. */
export const PINNED_FETCH_TIMEOUTS = { connectMs: 10_000, headersMs: 300_000, bodyMs: 300_000 };

/** The body of a `RequestInit` as bytes, the shapes the channels send. */
async function bodyBytes(body: RequestInit["body"]): Promise<Buffer | null> {
    if (body === undefined || body === null) return null;
    if (typeof body === "string") return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    // FormData, Blob, URLSearchParams and streams: the encoding `fetch` gives them, with its content type.
    const encoded = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
    return Buffer.from(await encoded.arrayBuffer());
}

/** The content type `fetch` sets for a body, like `text/plain;charset=UTF-8` for a string or the boundary of a FormData. */
function bodyType(body: RequestInit["body"]): string | null {
    if (body === undefined || body === null || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return null;
    return new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit).headers.get("content-type");
}

/** The headers of a request as `fetch` sends them: its defaults where the caller set none. */
function requestHeaders(init: RequestInit, type: string | null, length: number | null): Record<string, string> {
    const headers = new Headers(init.headers);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    if (!headers.has("user-agent")) headers.set("user-agent", "node");
    if (type && !headers.has("content-type")) headers.set("content-type", type);
    if (length !== null) headers.set("content-length", String(length));
    return Object.fromEntries(headers.entries());
}

/**
 * `fetch` over the agents of `guardedAgents`: one request, no redirect followed, an answer as a
 * `Response` whose body streams. Takes what the channels pass to `fetch`: a method, headers, a
 * body and a signal, and keeps its defaults and timeouts, see `PINNED_FETCH_TIMEOUTS`. A redirect
 * comes back as it is, like `redirect: "manual"`. An answer `Response` cannot hold, like a status
 * outside 200 to 599, fails the request.
 */
export async function pinnedFetch(url: string, init: RequestInit, reach: ReachPolicy, timeouts = PINNED_FETCH_TIMEOUTS): Promise<Response> {
    const target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new TypeError(`fetch of ${target.protocol} is not supported.`);
    init.signal?.throwIfAborted();
    const secure = target.protocol === "https:";
    const agents = guardedAgents(reach);
    const body = await bodyBytes(init.body);
    const headers = requestHeaders(init, bodyType(init.body), body ? body.length : null);

    // Agents without keep-alive, so the socket closes once the answer is read, and none outlives the send.
    return new Promise<Response>((resolve, reject) => {
        const timers: NodeJS.Timeout[] = [];
        const clear = () => timers.forEach((timer) => clearTimeout(timer));
        const fail = (error: Error) => {
            clear();
            request.destroy(error);
            reject(error);
        };
        const request = (secure ? https : http).request(target, {
            method: init.method ?? "GET",
            headers,
            agent: secure ? agents.httpsAgent : agents.httpAgent,
            signal: init.signal ?? undefined,
        }, (answer) => {
            clear();
            try {
                const status = answer.statusCode ?? 0;
                const answerHeaders = new Headers();
                for (const [name, value] of Object.entries(answer.headers)) {
                    for (const entry of Array.isArray(value) ? value : [value]) if (entry !== undefined) answerHeaders.append(name, entry);
                }
                const empty = NO_BODY.has(status) || request.method === "HEAD";
                const response = new Response(empty ? null : (Readable.toWeb(answer) as ReadableStream<Uint8Array>), { status, statusText: answer.statusMessage, headers: answerHeaders });
                if (empty) answer.resume();
                // Like undici, a body that stalls between two chunks fails.
                else answer.setTimeout(timeouts.bodyMs, () => answer.destroy(new Error(`The answer of ${target.host} sent nothing for ${timeouts.bodyMs / 1000} seconds.`)));
                resolve(response);
            } catch (error: unknown) {
                answer.destroy();
                fail(new Error(`${target.host} answered with status ${answer.statusCode}, which is no HTTP answer fetch reads.`, { cause: error }));
            }
        });
        request.once("socket", (socket) => {
            if (!socket.connecting) return;
            const timer = setTimeout(() => fail(new Error(`Connecting to ${target.host} took longer than ${timeouts.connectMs / 1000} seconds.`)), timeouts.connectMs);
            timers.push(timer);
            socket.once("connect", () => clearTimeout(timer));
        });
        timers.push(setTimeout(() => fail(new Error(`${target.host} sent no answer within ${timeouts.headersMs / 1000} seconds.`)), timeouts.headersMs));
        request.once("error", (error) => {
            clear();
            reject(error);
        });
        request.end(body ?? undefined);
    });
}
