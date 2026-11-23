import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { AdapterError } from "@/lib/logging/errors";
import { collectCapped } from "@/lib/adapters/storage/common/read-limit";
import type { CloudflareD1Config } from "@/lib/adapters/definitions";

/**
 * The REST API of Cloudflare D1, the only way this adapter reaches a database.
 *
 * Every call goes to the fixed host `api.cloudflare.com` with the API token as a bearer token. The
 * token never appears in a log line or an error message, and neither does a signed URL, see
 * `transfer.ts`.
 */

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";

/** A single API call answers within this time, the long work (export, import) is polled. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The largest answer of the API this adapter reads. D1 caps a query result at 50 MB itself. The
 * Database Explorer asks for less, see `BROWSE_RESPONSE_LIMIT` in `browser.ts`.
 */
const RESPONSE_LIMIT = 64 * 1024 * 1024;

/** An account ID is 32 hex characters. Checked before it becomes part of a URL. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

/** A database ID is a UUID. Checked before it becomes part of a URL. */
const DATABASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields of a connection this client reads. The token comes from the credential profile. */
export type D1Connection = Pick<CloudflareD1Config, "accountId"> & { token?: string };

/** A D1 database as list and get describe it. */
export interface D1Database {
    uuid: string;
    name: string;
    version?: string;
    jurisdiction?: string | null;
    file_size?: number;
    num_tables?: number;
    created_at?: string;
    running_in_region?: string;
}

/** One statement's result of the query endpoint. */
export interface D1QueryResult<Row = Record<string, unknown>> {
    results: Row[];
    success: boolean;
    meta?: { served_by_region?: string; rows_read?: number; duration?: number };
}

/** One statement's result of the raw endpoint, rows as arrays. */
export interface D1RawResult {
    results: { columns: string[]; rows: unknown[][] };
    success: boolean;
}

interface Envelope<T> {
    success?: boolean;
    errors?: { code?: number; message?: string }[];
    result?: T;
    result_info?: { page?: number; per_page?: number; count?: number; total_count?: number };
}

/** Cloudflare's own error codes this adapter turns into a sentence a person can act on. */
const AUTHENTICATION_ERROR = 10000;
const INVALID_TOKEN = 1000;
const NO_PERMISSION = 7500;

/**
 * Whether an error is a call the API refused for a missing right, as opposed to a request that is
 * wrong. `d1Request` keeps the status and the codes of Cloudflare in the context of its
 * `AdapterError`. A plain `AdapterError` rather than a subclass, since suites that replace the
 * module of the error classes load this file too.
 */
export function isPermissionRefusal(error: unknown): boolean {
    const context = error instanceof Error ? (error as Error & { context?: { status?: number; codes?: number[] } }).context : undefined;
    const status = context?.status;
    const codes = Array.isArray(context?.codes) ? context.codes : [];
    return status === 401 || status === 403 || codes.includes(AUTHENTICATION_ERROR) || codes.includes(NO_PERMISSION);
}

/** The account ID of a config, refused unless it has the form Cloudflare gives it. */
export function accountIdOf(config: D1Connection): string {
    const id = typeof config.accountId === "string" ? config.accountId.trim() : "";
    if (!ACCOUNT_ID.test(id)) {
        throw new AdapterError("cloudflare-d1", "config", "The account ID must be the 32 hex characters shown in the Cloudflare dashboard.");
    }
    return id.toLowerCase();
}

/** A database ID from an answer of the API, refused unless it is a UUID. */
export function databaseIdOf(id: unknown): string {
    if (typeof id !== "string" || !DATABASE_ID.test(id)) {
        throw new AdapterError("cloudflare-d1", "api", "Cloudflare answered with a database ID that is not a UUID.");
    }
    return id.toLowerCase();
}

function tokenOf(config: D1Connection): string {
    const token = typeof config.token === "string" ? config.token.trim() : "";
    if (!token) {
        throw new AdapterError("cloudflare-d1", "config", "No API token. Pick a credential profile of the type Token.");
    }
    return token;
}

/** Reads an answer of the API as JSON, at most `limit` bytes of it. */
async function readEnvelope<T>(response: Response, limit: number): Promise<Envelope<T> | null> {
    if (!response.body) return null;
    const bytes = await collectCapped(Readable.fromWeb(response.body as WebReadableStream), limit);
    try {
        return JSON.parse(bytes.toString("utf-8")) as Envelope<T>;
    } catch {
        return null;
    }
}

/** A sentence for a refused call, without anything of the request in it. */
function describeFailure(status: number, envelope: Envelope<unknown> | null): { message: string; codes: number[] } {
    const errors = envelope?.errors ?? [];
    const codes = errors.map((error) => Number(error.code)).filter((code) => Number.isFinite(code));
    if (status === 401 || codes.includes(AUTHENTICATION_ERROR) || codes.includes(INVALID_TOKEN)) {
        return { codes, message: "Cloudflare refused the API token. Check that it is active, belongs to this account and has the permission D1 Edit." };
    }
    if (status === 403 || codes.includes(NO_PERMISSION)) {
        return { codes, message: "The API token is missing a permission for this. It needs D1 Edit." };
    }
    const detail = errors.map((error) => error.message).filter(Boolean).join("; ");
    return { codes, message: detail ? `Cloudflare answered ${status}: ${detail}` : `Cloudflare answered ${status}.` };
}

/**
 * One call of the API, with the path below `/accounts/<id>`. Answers the `result` of the envelope
 * and throws an `AdapterError` with the status and the codes of Cloudflare in its context for anything
 * Cloudflare refused.
 */
export async function d1Request<T>(
    config: D1Connection,
    operation: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    responseLimit = RESPONSE_LIMIT,
): Promise<{ result: T; resultInfo?: Envelope<T>["result_info"] }> {
    const url = `${API_BASE}/${accountIdOf(config)}${path}`;
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${tokenOf(config)}`,
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: "error",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error: unknown) {
        if (error instanceof AdapterError) throw error;
        const reason = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
        throw new AdapterError("cloudflare-d1", operation, `The Cloudflare API ${reason}.`);
    }

    let envelope: Envelope<T> | null;
    try {
        envelope = await readEnvelope<T>(response, responseLimit);
    } catch (error: unknown) {
        const reason = error instanceof Error && error.name === "FileTooLargeError" ? "answered more than DBackup reads of one answer" : "broke off its answer";
        throw new AdapterError("cloudflare-d1", operation, `The Cloudflare API ${reason}.`, { context: { status: response.status, codes: [] } });
    }
    if (!response.ok || !envelope?.success) {
        const { message, codes } = describeFailure(response.status, envelope);
        throw new AdapterError("cloudflare-d1", operation, message, { context: { status: response.status, codes } });
    }
    return { result: envelope.result as T, resultInfo: envelope.result_info };
}

/** How many databases one page of the list holds. The API allows up to 10'000. */
const LIST_PAGE_SIZE = 1000;

/** The most pages the list reads, a bound in case the API keeps answering full pages. */
const LIST_MAX_PAGES = 100;

/** Every D1 database of the account, across all pages of the list. */
export async function listDatabases(config: D1Connection): Promise<D1Database[]> {
    const all: D1Database[] = [];
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
        const { result, resultInfo } = await d1Request<D1Database[]>(config, "list", "GET", `/d1/database?page=${page}&per_page=${LIST_PAGE_SIZE}`);
        const rows = Array.isArray(result) ? result : [];
        all.push(...rows);
        const total = resultInfo?.total_count;
        if (rows.length < LIST_PAGE_SIZE || (typeof total === "number" && all.length >= total)) break;
    }
    return all.filter((db) => typeof db.name === "string" && typeof db.uuid === "string");
}

/** The database of this name, or null. Names are unique within an account. */
export async function findDatabase(config: D1Connection, name: string): Promise<D1Database | null> {
    // The name filter of the API matches more than the exact name, so a full page can hide it.
    const { result } = await d1Request<D1Database[]>(config, "list", "GET", `/d1/database?name=${encodeURIComponent(name)}&per_page=100`);
    const rows = Array.isArray(result) ? result : [];
    const match = rows.find((db) => db.name === name);
    if (match || rows.length < 100) return match ?? null;
    return (await listDatabases(config)).find((db) => db.name === name) ?? null;
}

/** The database of this name, refused when the account has none. */
export async function requireDatabase(config: D1Connection, name: string, operation: string): Promise<D1Database & { uuid: string }> {
    const db = await findDatabase(config, name);
    if (!db) throw new AdapterError("cloudflare-d1", operation, `The account has no D1 database named "${name}".`);
    return { ...db, uuid: databaseIdOf(db.uuid) };
}

/** The details of one database, its size among them. */
export async function getDatabase(config: D1Connection, uuid: string): Promise<D1Database> {
    const { result } = await d1Request<D1Database>(config, "get", "GET", `/d1/database/${databaseIdOf(uuid)}`);
    return result;
}

/** Runs SQL through the query endpoint, rows as objects. */
export async function query<Row = Record<string, unknown>>(
    config: D1Connection,
    uuid: string,
    sql: string,
    params?: unknown[],
    responseLimit?: number,
): Promise<D1QueryResult<Row>[]> {
    const { result } = await d1Request<D1QueryResult<Row>[]>(config, "query", "POST", `/d1/database/${databaseIdOf(uuid)}/query`, params ? { sql, params } : { sql }, responseLimit);
    return Array.isArray(result) ? result : [];
}

/** Runs several statements as one batch, which D1 runs in one transaction. */
export async function batch(config: D1Connection, uuid: string, statements: { sql: string; params?: unknown[] }[]): Promise<D1QueryResult[]> {
    const { result } = await d1Request<D1QueryResult[]>(config, "query", "POST", `/d1/database/${databaseIdOf(uuid)}/query`, { batch: statements });
    return Array.isArray(result) ? result : [];
}

/** Runs SQL through the raw endpoint, rows as arrays with the column names apart. */
export async function rawQuery(config: D1Connection, uuid: string, sql: string, params?: unknown[], responseLimit?: number): Promise<D1RawResult[]> {
    const { result } = await d1Request<D1RawResult[]>(config, "query", "POST", `/d1/database/${databaseIdOf(uuid)}/raw`, params ? { sql, params } : { sql }, responseLimit);
    return Array.isArray(result) ? result : [];
}
