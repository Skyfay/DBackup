// @vitest-environment node
/**
 * Every API route against the tenant boundary. Each actor of tenant-sweep.ts calls every handler
 * of every route, with the ids of another tenant in the path, the query and the body. Whatever a
 * route answers, nothing of the other tenant leaves, changes, or gets linked into the first. The
 * other tests of the tenants check one feature each, this one keeps a new route from slipping
 * past them. server-action-sweep.test.ts does the same for the Server Actions.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ACTORS, ALL_IDS, G, MARK, POISON, expectBoundaryKept, holdsRecords, openSweepDatabase, rowsOf, type SweepApp, type SweepDatabase } from "./tenant-sweep";

const app: SweepApp = vi.hoisted(() => ({
    client: undefined as unknown,
    headers: new Headers(),
    session: null as unknown,
    fetched: [] as string[],
    spawned: [] as string[],
    blockProcesses: false,
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return app.client; } }));
vi.mock("next/headers", () => ({
    headers: async () => app.headers,
    cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// The session of the actor, or none when the request carries an API key. Every other call of the
// sign-in library fails, no route of a tenant's data needs one.
vi.mock("@/lib/auth", () => ({
    auth: {
        api: new Proxy({}, {
            get: (_target, name) => name === "getSession"
                ? async () => app.session
                : async () => { throw new Error(`auth.api.${String(name)} is not available in this test`); },
        }),
    },
}));
// No process starts during the sweep, a client of a database or SSH included. One that tries is
// noted with its arguments, which hold the host and the login it was given.
vi.mock("child_process", async (importOriginal) => {
    const original = await importOriginal<typeof import("child_process")>();
    const guard = <F extends (...args: never[]) => unknown>(name: string, fn: F) => ((...args: unknown[]) => {
        if (!app.blockProcesses) return (fn as unknown as (...inner: unknown[]) => unknown)(...args);
        app.spawned.push(`${name} ${JSON.stringify(args.slice(0, 3))}`);
        throw new Error("no processes in this test");
    }) as unknown as F;
    const wrapped = {
        ...original,
        spawn: guard("spawn", original.spawn), spawnSync: guard("spawnSync", original.spawnSync),
        exec: guard("exec", original.exec), execSync: guard("execSync", original.execSync),
        execFile: guard("execFile", original.execFile), execFileSync: guard("execFileSync", original.execFileSync),
        fork: guard("fork", original.fork),
    };
    return { ...wrapped, default: wrapped };
});
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn(async () => undefined) } }));
vi.mock("@/lib/execution/queue-manager", () => ({ processQueue: vi.fn(async () => undefined) }));

const API = path.resolve(__dirname, "../../../src/app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * The routes that never reach the data of a tenant, each with why. They are left out of the sweep.
 */
const NOT_OF_A_TENANT: Record<string, string> = {
    "auth/[...all]": "the sign-in library, checked by the tests of sign-in",
};

let db: SweepDatabase;

/** The handlers of a route file, with the path of the route like `jobs/[id]/runs`. */
function routes() {
    const found: { route: string; file: string }[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === "route.ts") found.push({ route: path.relative(API, dir).split(path.sep).join("/"), file: full });
        }
    };
    walk(API);
    return found.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * The ids of the other tenant a route is tried with, by the first part of its path. A route not
 * listed gets every id, so a new one is covered before anyone adds it here.
 */
const IDS_BY_ROUTE: Record<string, readonly string[]> = {
    adapters: [G.source, G.storage, G.channel],
    "api-keys": [G.apikey],
    audit: [G.audit],
    avatar: [G.user],
    credentials: [G.credential, G.oauth],
    databases: [G.source],
    executions: [G.execution],
    groups: [G.group],
    history: [G.execution],
    jobs: [G.job],
    "notification-logs": [G.notification],
    storage: [G.storage],
    tenants: [G.tenant, G.user],
    users: [G.user],
};

/**
 * The values of the dynamic segments of a route. Every segment gets an id of the other tenant, and
 * a route with more than one also gets its first segment from the own tenant, like a member of
 * another tenant asked for through the own one.
 */
function paramsOf(route: string): Record<string, string | string[]>[] {
    const names = [...route.matchAll(/\[(\.\.\.)?(\w+)\]/g)].map((match) => ({ name: match[2], catchAll: Boolean(match[1]) }));
    if (names.length === 0) return [{}];
    const ids = IDS_BY_ROUTE[route.split("/")[0]] ?? ALL_IDS;
    const values = (first: string, rest: string) => Object.fromEntries(names.map(({ name, catchAll }, index) => {
        const value = index === 0 ? first : rest;
        return [name, catchAll ? [value] : value];
    }));
    return ids.flatMap((id) => [values(id, id), ...(names.length > 1 ? [values(id.replace("globex", "acme"), id)] : [])]);
}

/**
 * The fields the request names records by. A route that works with a saved login gets a second
 * pass with the OAuth login of the other tenant, since a login of the wrong type stops early.
 */
function poisonsOf(file: string): Record<string, unknown>[] {
    if (!/credential/i.test(readFileSync(file, "utf8"))) return [POISON];
    const oauth = Object.fromEntries(Object.keys(POISON).filter((key) => /credential/i.test(key)).map((key) => [key, G.oauth]));
    return [POISON, { ...POISON, ...oauth }];
}

function requestFor(method: string, route: string, params: Record<string, string | string[]>, poison: Record<string, unknown>) {
    const pathname = route.replace(/\[(\.\.\.)?(\w+)\]/g, (_match, _dots, name: string) => [params[name]].flat().join("/"));
    const query = new URLSearchParams(Object.entries(poison).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value)]));
    const body = method === "GET" || method === "DELETE" ? undefined : JSON.stringify(poison);
    return new NextRequest(`http://localhost/api/${pathname}?${query}`, {
        method,
        headers: { ...Object.fromEntries(app.headers), ...(body ? { "content-type": "application/json" } : {}) },
        body,
    });
}

/** The answer of one call as text, with a call that throws or hangs reported as such. */
async function call(handler: (...args: unknown[]) => Promise<Response>, request: NextRequest, params: object) {
    const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("no answer within 10 s")), 10_000));
    try {
        const response = await Promise.race([handler(request, { params: Promise.resolve(params) }), timeout]);
        const text = response instanceof Response ? await Promise.race([response.text(), timeout]) : JSON.stringify(response ?? null);
        return { status: response instanceof Response ? response.status : 200, text };
    } catch (error) {
        return { status: -1, text: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
}

beforeAll(async () => {
    db = await openSweepDatabase(app, "route-sweep");
}, 120_000);

afterAll(async () => {
    await db?.close();
});

describe("every API route", () => {
    it.each(ACTORS)("gives %s nothing of another tenant, and changes or links nothing of it", async (actor) => {
        const before = await rowsOf(db.base, "globex");
        const leaks: string[] = [];
        const answered: string[] = [];
        const broken: string[] = [];

        const statuses = new Map<number, number>();
        for (const { route, file } of routes()) {
            if (route in NOT_OF_A_TENANT) continue;
            const handlers = (await import(file)) as Partial<Record<(typeof METHODS)[number], (...args: unknown[]) => Promise<Response>>>;
            for (const method of METHODS) {
                const handler = handlers[method];
                if (typeof handler !== "function") continue;
                for (const params of paramsOf(route)) for (const [pass, poison] of poisonsOf(file).entries()) {
                    db.actAs(actor);
                    const label = `${method} /api/${route} ${JSON.stringify(params)}${pass > 0 ? " (OAuth login)" : ""}`;
                    const { status, text } = await call(handler, requestFor(method, route, params, poison), params);
                    if (text.includes(MARK)) leaks.push(`${label} -> ${status}: ${text.slice(0, 300)}`);
                    // A route that names a record of the other tenant in its path never hands one out.
                    if (Object.keys(params).length > 0 && status >= 200 && status < 300 && !(route in NOT_OF_A_TENANT) && holdsRecords(text)) {
                        answered.push(`${label} -> ${status}: ${text.slice(0, 300)}`);
                    }
                    statuses.set(status, (statuses.get(status) ?? 0) + 1);
                    if (status === -1) broken.push(`${label}: ${text}`);
                }
            }
        }

        expect.soft(leaks, "answers that hold data of the other tenant").toEqual([]);
        expect.soft(answered, "routes that handed out a record for an id of the other tenant").toEqual([]);
        await expectBoundaryKept(db.base, app, before);
        // Handlers that throw instead of answering are listed for the reader, they are not a leak.
        process.stdout.write(`${actor}: ${JSON.stringify(Object.fromEntries([...statuses].sort((a, b) => a[0] - b[0])))}\n`);
        if (broken.length > 0) process.stdout.write(`${actor}: ${broken.length} calls threw\n${broken.join("\n")}\n`);
    }, 600_000);
});
