// @vitest-environment node
/**
 * Every API route against the tenant boundary, against a real SQLite database migrated with the
 * migrations of this version. The admin of one tenant calls every handler of every route, with
 * the ids of another tenant in the path, the query and the body, once with a session and once
 * with an API key. Whatever a route answers, nothing of the other tenant leaves, changes, or gets
 * linked into the first. The other tests of the tenants check one feature each, this one keeps a
 * new route from slipping past them.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const app = vi.hoisted(() => ({
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

const { runAsTenant } = await import("@/lib/tenant/context");
const { apiKeyService } = await import("@/services/auth/api-key-service");
const { AVAILABLE_PERMISSIONS, PLATFORM_ONLY_PERMISSIONS } = await import("@/lib/auth/permissions");
const { PLATFORM_PERMISSIONS } = await import("@/lib/auth/owner-permissions");
const { encrypt } = await import("@/lib/crypto");

const API = path.resolve(__dirname, "../../../src/app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
/** Written into every name and setting of the other tenant. An answer that holds it leaked. */
const MARK = "zz-globex-private";
const NOW = new Date("2026-11-20T10:00:00.000Z");

/**
 * The routes that never reach the data of a tenant, each with why. Their handlers still run in the
 * sweep, the answers are only not checked for a status.
 */
const NOT_OF_A_TENANT: Record<string, string> = {
    "auth/[...all]": "the sign-in library, checked by the tests of sign-in",
};

/** The ids of the other tenant, one for each kind of record a route can name. */
const G = {
    source: "globex-source", storage: "globex-nas", channel: "globex-mail", credential: "globex-credential",
    key: "globex-key", retention: "globex-retention", naming: "globex-naming", schedule: "globex-schedule",
    exclude: "globex-exclude", template: "globex-template", job: "globex-job", execution: "globex-execution",
    apikey: "globex-apikey", audit: "globex-audit", notification: "globex-notification", snapshot: "globex-snapshot",
    trash: "globex-trash", group: "globex-group", request: "globex-request", recipients: "globex-recipients",
    user: "globex-user", tenant: "globex", oauth: "globex-oauth",
} as const;
const ALL_IDS = [...new Set(Object.values(G))];

/** Fields a body or a query names a record by, filled with the other tenant's. */
const POISON: Record<string, unknown> = {
    id: G.job, ids: ALL_IDS, tenantId: G.tenant, userId: G.user, userIds: [G.user],
    configId: G.source, sourceId: G.source, sourceIds: [G.source], databaseId: G.source,
    storageId: G.storage, destinationId: G.storage, destinationIds: [G.storage], storageConfigId: G.storage,
    adapterConfigId: G.storage, channelId: G.channel, channelIds: [G.channel], notificationIds: [G.channel],
    credentialId: G.credential, credentialProfileId: G.credential, sshCredentialId: G.credential,
    encryptionProfileId: G.key, keyId: G.key, profileId: G.key, retentionPolicyId: G.retention,
    namingTemplateId: G.naming, schedulePresetId: G.schedule, excludePatternPresetId: G.exclude,
    templateId: G.template, notificationTemplateId: G.template, jobId: G.job, jobIds: [G.job],
    executionId: G.execution, executionIds: [G.execution], runId: G.execution, apiKeyId: G.apikey,
    groupId: G.group, groupIds: [G.group], snapshotId: G.snapshot, requestId: G.request,
    recordId: G.trash, recordIds: [G.trash], file: "backup.sql", path: "/", name: "Probe",
};

let root = "";
let base: PrismaClient;
let acmeKey = "";

type Actor = { name: string; use: () => void };
const SESSION: Actor = {
    name: "the admin of a tenant with a session",
    use: () => {
        app.headers = new Headers({ "user-agent": "sweep", cookie: "better-auth.session_token=acme" });
        app.session = {
            user: { id: "acme-admin", name: "Anna", email: "anna@acme.example", emailVerified: true, createdAt: NOW, updatedAt: NOW },
            session: { id: "acme-session", userId: "acme-admin", token: "acme", activeTenantId: "acme", createdAt: NOW, updatedAt: NOW, expiresAt: new Date(Date.now() + 3_600_000) },
        };
    },
};
/** Someone of the MSP whose platform group reaches Acme and no other tenant, working in Acme. */
const PLATFORM_GROUP: Actor = {
    name: "someone of a platform group that reaches one tenant",
    use: () => {
        app.headers = new Headers({ "user-agent": "sweep", cookie: "better-auth.session_token=msp" });
        app.session = {
            user: { id: "msp-nina", name: "Nina", email: "nina@msp.example", emailVerified: true, createdAt: NOW, updatedAt: NOW },
            session: { id: "msp-session", userId: "msp-nina", token: "msp", activeTenantId: "acme", createdAt: NOW, updatedAt: NOW, expiresAt: new Date(Date.now() + 3_600_000) },
        };
    },
};
const API_KEY: Actor = {
    name: "the admin of a tenant with an API key",
    use: () => {
        app.headers = new Headers({ "user-agent": "sweep", authorization: `Bearer ${acmeKey}` });
        app.session = null;
    },
};

/** One row of the tenant models for a tenant. Every name and setting of Globex carries the mark. */
async function seedTenant(tenantId: "acme" | "globex") {
    const id = (name: string) => `${tenantId}-${name}`;
    const label = (name: string) => (tenantId === "globex" ? `${name} ${MARK}` : name);
    const config = JSON.stringify(tenantId === "globex" ? { host: `${MARK}.invalid`, user: MARK, password: MARK, path: `/srv/${MARK}` } : { host: "acme.invalid" });
    await base.tenant.create({ data: { id: tenantId, name: label(tenantId) } });
    await base.group.create({ data: { tenantId, id: id("admins"), name: label("Admin"), permissions: "[]", fullAccess: true } });
    await base.user.create({ data: { id: id("user"), name: label(tenantId), email: `${tenantId}@example.ch`, emailVerified: true, createdAt: NOW, updatedAt: NOW, memberships: { create: { tenantId, groupId: id("admins") } } } });
    // Encrypted like the app does, so a route that reads one of the other tenant could use it.
    const secret = tenantId === "globex" ? MARK : tenantId;
    await base.credentialProfile.create({ data: { tenantId, id: id("credential"), name: label("Login"), type: "USERNAME_PASSWORD", data: encrypt(JSON.stringify({ username: secret, password: secret })) } });
    await base.credentialProfile.create({ data: { tenantId, id: id("oauth"), name: label("Drive"), type: "OAUTH", data: encrypt(JSON.stringify({ clientId: secret, clientSecret: secret, refreshToken: secret })) } });
    await base.encryptionProfile.create({ data: { tenantId, id: id("key"), name: label("Key"), secretKey: "not-a-real-secret" } });
    await base.adapterConfig.create({ data: { tenantId, id: id("source"), name: label("Shop"), type: "database", adapterId: "mysql", config } });
    await base.adapterConfig.create({ data: { tenantId, id: id("nas"), name: label("NAS"), type: "storage", adapterId: "local-filesystem", config } });
    await base.adapterConfig.create({ data: { tenantId, id: id("mail"), name: label("Mail"), type: "notification", adapterId: "email", config } });
    await base.retentionPolicy.create({ data: { tenantId, id: id("retention"), name: label("Keep 7"), config: "{}" } });
    await base.namingTemplate.create({ data: { tenantId, id: id("naming"), name: label("Dated"), pattern: "{name}" } });
    await base.schedulePreset.create({ data: { tenantId, id: id("schedule"), name: label("Nightly"), schedule: "0 3 * * *" } });
    await base.excludePatternPreset.create({ data: { tenantId, id: id("exclude"), name: label("No cache"), patterns: "[]" } });
    await base.notificationTemplate.create({ data: { tenantId, id: id("template"), name: label("Failures") } });
    await base.job.create({
        data: {
            tenantId, id: id("job"), name: label("Nightly shop"), schedule: "0 3 * * *", sourceId: id("source"),
            destinations: { create: { id: id("destination"), configId: id("nas") } },
        },
    });
    await base.execution.create({ data: { tenantId, id: id("execution"), jobId: id("job"), status: "Success", logs: JSON.stringify([label("log")]), path: `/srv/${label("dump")}.sql` } });
    await base.apiKey.create({ data: { tenantId, id: id("apikey"), name: label("CI"), prefix: `dbackup_${tenantId}`, hashedKey: id("hash"), permissions: "[]", userId: id("user") } });
    await base.auditLog.create({ data: { tenantId, id: id("audit"), action: "CREATE", resource: "JOB", details: JSON.stringify({ name: label("job") }) } });
    await base.notificationLog.create({ data: { tenantId, id: id("notification"), eventType: "backup_success", channelName: label("Mail"), adapterId: "email", status: "Success", title: label("Done"), message: label("Done") } });
    await base.storageSnapshot.create({ data: { tenantId, id: id("snapshot"), adapterConfigId: id("nas"), adapterName: label("NAS"), adapterId: "local-filesystem" } });
    await base.deletedRecord.create({ data: { tenantId, id: id("trash"), kind: "job", recordId: id("gone"), name: label("Old job"), data: "{}", permission: "jobs:write" } });
    await base.group.create({ data: { tenantId, id: id("group"), name: label("Operators"), permissions: "[]" } });
    await base.sharedServer.create({ data: { tenantId, id: id("source"), name: label("Shop"), adapterId: "mysql" } });
    await base.sharedBackupRequest.create({ data: { tenantId, id: id("request"), sourceId: id("source"), databaseName: label("shop"), executionId: id("execution") } });
    await base.channelRecipients.create({ data: { tenantId, id: id("recipients"), configId: id("mail"), recipients: JSON.stringify([`${tenantId}@example.ch`]) } });
}

/** The models whose rows belong to a tenant, by the name of their delegate. */
const TENANT_DELEGATES = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "tenantId" && field.kind === "scalar"))
    .map((model) => model.name[0].toLowerCase() + model.name.slice(1));

type Delegate = { findMany(args?: object): Promise<Record<string, unknown>[]> };
const delegate = (name: string) => (base as unknown as Record<string, Delegate>)[name];

/** Every row of a tenant in every model that names one, plus the accounts of its people. */
async function rowsOf(tenantId: string) {
    const rows: Record<string, unknown[]> = {};
    for (const name of TENANT_DELEGATES) rows[name] = await delegate(name).findMany({ where: { tenantId } });
    rows.user = await base.user.findMany({ where: { memberships: { some: { tenantId } } } });
    return rows;
}

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

/**
 * Whether an answer holds a record: a list with entries, or an object with more than the
 * envelope. `{ success: true, data: [] }` holds none, a route that lists the children of a record
 * finds none of a record the filter of the tenant hides.
 */
function holdsRecords(text: string): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return text.length > 0;
    }
    const holds = (value: unknown): boolean => {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === "object") {
            return Object.entries(value).some(([key, inner]) => !["success", "error", "message"].includes(key) && holds(inner));
        }
        // Zeros, nulls and empty strings of an empty summary hold nothing.
        return value !== null && value !== undefined && value !== 0 && value !== "" && value !== false;
    };
    return holds(parsed);
}

/** Rows as text, with the BigInt columns of sizes written as numbers. */
const asText = (value: unknown) => JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? Number(inner) : inner));

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
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-route-sweep-"));
    const file = path.join(root, "sweep.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => (await import("@/lib/tenant/current")).requestScope()));
    for (const tenant of ["acme", "globex"] as const) await seedTenant(tenant);
    // Anna, the admin of Acme. Not an admin of the platform, so every check of a tenant applies.
    await base.user.create({ data: { id: "acme-admin", name: "Anna", email: "anna@acme.example", emailVerified: true, createdAt: NOW, updatedAt: NOW, memberships: { create: { tenantId: "acme", groupId: "acme-admins" } } } });
    // Nina of the MSP: every right of a tenant and of the platform a group can give, in Acme only.
    // The settings of the instance stay out, they act on no tenant and restore whole configurations.
    await base.platformGroup.create({
        data: {
            id: "pg-acme", name: "Acme support",
            platformPermissions: JSON.stringify(PLATFORM_ONLY_PERMISSIONS.map((permission) => permission.id)),
            tenantPermissions: JSON.stringify(AVAILABLE_PERMISSIONS.map((permission) => permission.id).filter((permission) => !PLATFORM_PERMISSIONS.has(permission))),
            allTenants: false,
            tenants: { create: [{ tenantId: "acme" }] },
        },
    });
    await base.user.create({ data: { id: "msp-nina", name: "Nina", email: "nina@msp.example", emailVerified: true, createdAt: NOW, updatedAt: NOW, platformGroupId: "pg-acme" } });
    acmeKey = (await runAsTenant("acme", () => apiKeyService.create({ name: "Acme panel", permissions: AVAILABLE_PERMISSIONS.map((permission) => permission.id), userId: "acme-admin" }))).rawKey;
    // Nothing of the sweep may leave the machine. A call that tries reports its address.
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        app.fetched.push(`${url} ${JSON.stringify(Object.fromEntries(new Headers(init?.headers)))} ${typeof init?.body === "string" ? init.body : ""}`);
        throw new Error("no network in this test");
    }));
    app.blockProcesses = true;
}, 120_000);

afterAll(async () => {
    app.blockProcesses = false;
    vi.unstubAllGlobals();
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe.each([SESSION, API_KEY, PLATFORM_GROUP])("$name", (actor) => {
    it("gets nothing of another tenant from any route, and changes or links nothing of it", async () => {
        const before = await rowsOf("globex");
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
                    actor.use();
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
        expect.soft(app.fetched.filter((sent) => sent.includes(MARK)), "requests with a login or a server of the other tenant").toEqual([]);
        expect.soft(app.spawned.filter((started) => started.includes(MARK)), "processes started with a login or a server of the other tenant").toEqual([]);
        // Nothing of the other tenant changed, and nothing new landed in it.
        expect.soft(asText(await rowsOf("globex")), "rows of the other tenant").toBe(asText(before));
        // Nothing of the first tenant points at a record of the other.
        const own = asText(await rowsOf("acme"));
        expect.soft(ALL_IDS.filter((id) => id !== G.tenant && own.includes(`"${id}"`)), "records of Acme that link one of Globex").toEqual([]);
        // Handlers that throw instead of answering are listed for the reader, they are not a leak.
        process.stdout.write(`${actor.name}: ${JSON.stringify(Object.fromEntries([...statuses].sort((a, b) => a[0] - b[0])))}\n`);
        if (broken.length > 0) process.stdout.write(`${actor.name}: ${broken.length} calls threw\n${broken.join("\n")}\n`);
    }, 600_000);
});
