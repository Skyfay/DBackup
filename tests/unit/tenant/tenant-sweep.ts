/**
 * The setup the sweeps over the entry points share: a real SQLite database migrated with the
 * migrations of this version, two tenants whose rows of every model carry their name, Globex's
 * also a mark in every name, setting and login, three actors who work in Acme, and the checks
 * that nothing of Globex left, changed or got linked. See api-route-sweep.test.ts and
 * server-action-sweep.test.ts, which mock the modules this file reaches through `SweepApp`.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { expect, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";

/** What a sweep shares with its mocks, created with `vi.hoisted` in the test file. */
export interface SweepApp {
    client: unknown;
    headers: Headers;
    session: unknown;
    /** Every request the code tried, with its headers and body. */
    fetched: string[];
    /** Every process the code tried to start, with its arguments. */
    spawned: string[];
    blockProcesses: boolean;
}

/** Written into every name, setting and login of the other tenant. Anything that holds it leaked. */
export const MARK = "zz-globex-private";
export const NOW = new Date("2026-11-20T10:00:00.000Z");

/** The ids of the other tenant, one for each kind of record an entry point can name. */
export const G = {
    source: "globex-source", storage: "globex-nas", channel: "globex-mail", credential: "globex-credential",
    key: "globex-key", retention: "globex-retention", naming: "globex-naming", schedule: "globex-schedule",
    exclude: "globex-exclude", template: "globex-template", job: "globex-job", execution: "globex-execution",
    apikey: "globex-apikey", audit: "globex-audit", notification: "globex-notification", snapshot: "globex-snapshot",
    trash: "globex-trash", group: "globex-group", request: "globex-request", recipients: "globex-recipients",
    user: "globex-user", tenant: "globex", oauth: "globex-oauth",
} as const;
export const ALL_IDS = [...new Set(Object.values(G))];

/** Fields a body, a query or an input names a record by, filled with the other tenant's. */
export const POISON: Record<string, unknown> = {
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

/** The actors a sweep runs as, all working in Acme. */
export const ACTORS = [
    "the admin of a tenant with a session",
    "the admin of a tenant with an API key",
    "someone of a platform group that reaches one tenant",
] as const;
export type ActorName = (typeof ACTORS)[number];

/**
 * Whether an answer holds a record: a list with entries, or an object with more than the
 * envelope. `{ success: true, data: [] }` holds none, a list of the children of a record the
 * filter of the tenant hides is empty.
 */
export function holdsRecords(text: string): boolean {
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

/** Rows and answers as text, with the BigInt columns of sizes written as numbers. */
export const asText = (value: unknown) => JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? Number(inner) : inner)) ?? "undefined";

/** One row of the tenant models for a tenant. Every name and setting of Globex carries the mark. */
async function seedTenant(base: PrismaClient, tenantId: "acme" | "globex", encrypt: (text: string) => string) {
    const id = (name: string) => `${tenantId}-${name}`;
    const label = (name: string) => (tenantId === "globex" ? `${name} ${MARK}` : name);
    const config = JSON.stringify(tenantId === "globex" ? { host: `${MARK}.invalid`, user: MARK, password: MARK, path: `/srv/${MARK}` } : { host: "acme.invalid" });
    await base.tenant.create({ data: { id: tenantId, name: label(tenantId) } });
    await base.group.create({ data: { tenantId, id: id("admins"), name: label("Admin"), permissions: "[]", fullAccess: true } });
    await base.user.create({ data: { id: id("user"), name: label(tenantId), email: `${tenantId}@example.ch`, emailVerified: true, createdAt: NOW, updatedAt: NOW, memberships: { create: { tenantId, groupId: id("admins") } } } });
    // Encrypted like the app does, so an entry point that reads one of the other tenant could use it.
    const secret = tenantId === "globex" ? MARK : tenantId;
    await base.credentialProfile.create({ data: { tenantId, id: id("credential"), name: label("Login"), type: "USERNAME_PASSWORD", data: encrypt(JSON.stringify({ username: secret, password: secret })) } });
    await base.credentialProfile.create({ data: { tenantId, id: id("oauth"), name: label("Drive"), type: "OAUTH", data: encrypt(JSON.stringify({ clientId: secret, clientSecret: secret, refreshToken: secret })) } });
    await base.encryptionProfile.create({ data: { tenantId, id: id("key"), name: label("Key"), secretKey: encrypt(secret.padEnd(64, "0").slice(0, 64)) } });
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

/** Every row of a tenant in every model that names one, plus the accounts of its people. */
export async function rowsOf(base: PrismaClient, tenantId: string) {
    const rows: Record<string, unknown[]> = {};
    for (const name of TENANT_DELEGATES) rows[name] = await (base as unknown as Record<string, Delegate>)[name].findMany({ where: { tenantId } });
    rows.user = await base.user.findMany({ where: { memberships: { some: { tenantId } } } });
    return rows;
}

export interface SweepDatabase {
    base: PrismaClient;
    /** Makes the next call run as this actor. */
    actAs(actor: ActorName): void;
    close(): Promise<void>;
}

/**
 * Migrates a database, seeds both tenants and the actors, and from then on keeps every request
 * and process of the code from leaving the machine. The three actors work in Acme: its admin with
 * a session, its admin with an API key holding every permission, and Nina of the MSP, whose
 * platform group reaches Acme alone and gives every right a group can give but the settings of
 * the instance, which act on no tenant and restore whole configurations.
 */
export async function openSweepDatabase(app: SweepApp, name: string): Promise<SweepDatabase> {
    const { tenantScopeExtension } = await import("@/lib/tenant/prisma-scope");
    const { runAsTenant } = await import("@/lib/tenant/context");
    const { apiKeyService } = await import("@/services/auth/api-key-service");
    const { AVAILABLE_PERMISSIONS, PLATFORM_ONLY_PERMISSIONS } = await import("@/lib/auth/permissions");
    const { PLATFORM_PERMISSIONS } = await import("@/lib/auth/owner-permissions");
    const { encrypt } = await import("@/lib/crypto");

    const root = mkdtempSync(path.join(os.tmpdir(), `dbackup-${name}-`));
    const file = path.join(root, "sweep.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    const base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => (await import("@/lib/tenant/current")).requestScope()));
    for (const tenant of ["acme", "globex"] as const) await seedTenant(base, tenant, encrypt);
    // Anna, the admin of Acme. Not an admin of the platform, so every check of a tenant applies.
    await base.user.create({ data: { id: "acme-admin", name: "Anna", email: "anna@acme.example", emailVerified: true, createdAt: NOW, updatedAt: NOW, memberships: { create: { tenantId: "acme", groupId: "acme-admins" } } } });
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
    const acmeKey = (await runAsTenant("acme", () => apiKeyService.create({ name: "Acme panel", permissions: AVAILABLE_PERMISSIONS.map((permission) => permission.id), userId: "acme-admin" }))).rawKey;

    // Nothing of the sweep may leave the machine. A call that tries reports what it sent.
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        app.fetched.push(`${url} ${JSON.stringify(Object.fromEntries(new Headers(init?.headers)))} ${typeof init?.body === "string" ? init.body : ""}`);
        throw new Error("no network in this test");
    }));
    app.blockProcesses = true;

    const session = (userId: string, name: string, email: string) => () => {
        app.headers = new Headers({ "user-agent": "sweep", cookie: `better-auth.session_token=${userId}` });
        app.session = {
            user: { id: userId, name, email, emailVerified: true, createdAt: NOW, updatedAt: NOW },
            session: { id: `${userId}-session`, userId, token: userId, activeTenantId: "acme", createdAt: NOW, updatedAt: NOW, expiresAt: new Date(Date.now() + 3_600_000) },
        };
    };
    const actors: Record<ActorName, () => void> = {
        "the admin of a tenant with a session": session("acme-admin", "Anna", "anna@acme.example"),
        "the admin of a tenant with an API key": () => {
            app.headers = new Headers({ "user-agent": "sweep", authorization: `Bearer ${acmeKey}` });
            app.session = null;
        },
        "someone of a platform group that reaches one tenant": session("msp-nina", "Nina", "nina@msp.example"),
    };

    return {
        base,
        actAs: (actor) => actors[actor](),
        async close() {
            app.blockProcesses = false;
            vi.unstubAllGlobals();
            await base.$disconnect();
            rmSync(root, { recursive: true, force: true });
        },
    };
}

/**
 * The checks after a sweep: no request or process used a login or a server of Globex, no row of
 * Globex changed or was added, and no row of Acme links a record of Globex.
 */
export async function expectBoundaryKept(base: PrismaClient, app: SweepApp, before: Record<string, unknown[]>) {
    expect.soft(app.fetched.filter((sent) => sent.includes(MARK)), "requests with a login or a server of the other tenant").toEqual([]);
    expect.soft(app.spawned.filter((started) => started.includes(MARK)), "processes started with a login or a server of the other tenant").toEqual([]);
    expect.soft(asText(await rowsOf(base, "globex")), "rows of the other tenant").toBe(asText(before));
    const own = asText(await rowsOf(base, "acme"));
    expect.soft(ALL_IDS.filter((id) => id !== G.tenant && own.includes(`"${id}"`)), "records of Acme that link one of Globex").toEqual([]);
}
