/**
 * Why the API key of a request was turned away, a disabled, expired or blocked key, by the headers
 * of the request. `getAuthContext` answers such a request without a context, like one without any
 * login, and keeps the sentence of the key here, so the 401 of the route says why (`unauthorized`
 * in `src/lib/server/unauthorized.ts`). One map for the whole process, like the contexts themselves.
 */

const REFUSALS_KEY = Symbol.for("dbackup.apiKeyRefusals");
type RefusalsGlobal = typeof globalThis & { [REFUSALS_KEY]?: WeakMap<Headers, string> };

function refusals(): WeakMap<Headers, string> {
    const holder = globalThis as RefusalsGlobal;
    holder[REFUSALS_KEY] ??= new WeakMap();
    return holder[REFUSALS_KEY];
}

/** Keeps why the key of this request was turned away. */
export function recordKeyRefusal(headersObj: Headers, message: string): void {
    if (typeof headersObj === "object" && headersObj !== null) refusals().set(headersObj, message);
}

/** Why the key of this request was turned away, null when it was not or there was none. */
export function keyRefusalOf(headersObj: Headers): string | null {
    if (typeof headersObj !== "object" || headersObj === null) return null;
    return refusals().get(headersObj) ?? null;
}
