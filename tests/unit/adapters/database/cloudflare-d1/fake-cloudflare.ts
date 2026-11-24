import { createHash } from "crypto";
import { vi } from "vitest";

/**
 * A stand-in for the API of Cloudflare and its R2 bucket behind `fetch`. Each test answers the
 * calls it cares about through `route`, every call is recorded with its parsed body.
 */

export const ACCOUNT = "0123456789abcdef0123456789abcdef";
export const DB_ID = "11111111-2222-3333-4444-555555555555";
export const NEW_ID = "66666666-7777-8888-9999-000000000000";
export const R2_URL = "https://abc123.r2.cloudflarestorage.com/export.sql?X-Amz-Signature=secret";

export interface Call {
    method: string;
    url: string;
    /** The path below `/accounts/<id>`, or the full URL for a call elsewhere. */
    path: string;
    body: unknown;
    headers: Record<string, string>;
    /** The text of an upload. */
    uploaded?: string;
}

export type Answer = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

export function ok(result: unknown, extra: Record<string, unknown> = {}): Answer {
    return { json: { success: true, errors: [], messages: [], result, ...extra } };
}

export function refused(status: number, code: number, message: string): Answer {
    return { status, json: { success: false, errors: [{ code, message }], messages: [], result: null } };
}

async function textOf(body: unknown): Promise<string | undefined> {
    if (body == null || typeof body === "string") return body ?? undefined;
    if (typeof (body as ReadableStream).getReader === "function") {
        return new Response(body as ReadableStream).text();
    }
    return undefined;
}

/** The table a restore makes its import end with, which it looks for and drops afterwards. */
const MARK = "_dbackup_restore_";

/**
 * Answers the check of a restore whether its import ran to the end: found, unless
 * `importRanToTheEnd` is false, like an import Cloudflare cut short.
 */
function completionCheck(call: Call, ranToTheEnd: boolean): Answer | undefined {
    const body = call.body as { sql?: string; params?: unknown[] } | undefined;
    if (!body?.sql) return undefined;
    if (String(body.params?.[0] ?? "").startsWith(MARK)) return ok([{ success: true, results: [{ n: ranToTheEnd ? 1 : 0 }] }]);
    if (body.sql.startsWith(`DROP TABLE IF EXISTS "${MARK}`)) return ok([{ success: true, results: [] }]);
    return undefined;
}

export function fakeCloudflare(route: (call: Call) => Answer | undefined, options: { importRanToTheEnd?: boolean } = {}) {
    const calls: Call[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = String(input);
        const prefix = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
        const raw = typeof init.body === "string" ? init.body : undefined;
        const call: Call = {
            method: init.method ?? "GET",
            url,
            path: url.startsWith(prefix) ? url.slice(prefix.length) : url,
            body: raw ? JSON.parse(raw) : undefined,
            headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
        };
        if (call.method === "PUT") call.uploaded = await textOf(init.body);
        calls.push(call);
        const answer = completionCheck(call, options.importRanToTheEnd !== false) ?? route(call) ?? { status: 404, json: { success: false, errors: [{ code: 7404, message: `no route for ${call.method} ${call.path}` }] } };
        const body = answer.text ?? JSON.stringify(answer.json ?? {});
        return new Response(body, { status: answer.status ?? 200, headers: answer.headers });
    });
    vi.stubGlobal("fetch", fetchMock);
    return { calls, fetchMock };
}

export const config = { accountId: ACCOUNT, token: "test-token", database: "", checkValues: false, newDatabaseLocation: "auto" };

/** A dump as Cloudflare's export writes it. */
export const DUMP = "PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE t (id INTEGER PRIMARY KEY);\nINSERT INTO \"t\" VALUES(1);\n";

export const md5 = (text: string) => createHash("md5").update(text).digest("hex");

/** The list of databases the account answers, by name and ID. */
export const listing = (names: Record<string, string>, jurisdiction?: string) => (call: Call): Answer | undefined =>
    call.method === "GET" && call.path.startsWith("/d1/database?")
        ? ok(Object.entries(names).map(([name, uuid]) => ({ name, uuid, jurisdiction: jurisdiction ?? null })))
        : undefined;

/** Answers the import flow into one database, the upload with the MD5 of what arrived. */
export function importing(uuid: string, outcome: Record<string, unknown> = { status: "complete", result: { num_queries: 3 } }) {
    return (call: Call): Answer | undefined => {
        if (call.method === "PUT") return { headers: { etag: `"${md5(call.uploaded ?? "")}"` } };
        if (call.path !== `/d1/database/${uuid}/import`) return undefined;
        const action = (call.body as { action: string }).action;
        if (action === "init") return ok({ upload_url: "https://abc.r2.cloudflarestorage.com/up?sig=1", filename: "f.sql" });
        return ok(outcome);
    };
}
