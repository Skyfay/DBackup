// @vitest-environment node
/**
 * Every Server Action against the tenant boundary. Each actor of tenant-sweep.ts calls every
 * exported action, with the ids of another tenant in its arguments. The arguments come from the
 * signature of the action, read with the compiler: a parameter that names a record gets the ids of
 * the other tenant, an object or a form the fields of `POISON`, the rest a plain value. Whatever an
 * action returns or throws, nothing of the other tenant leaves, changes, or gets linked into the
 * first. A new action is covered without anyone adding it here.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTORS, ALL_IDS, G, MARK, POISON, asText, expectBoundaryKept, holdsRecords, openSweepDatabase, rowsOf, type SweepApp, type SweepDatabase } from "./tenant-sweep";

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
// The session of the actor, or none when the request carries an API key. Every other call of the
// sign-in library fails, no action on the data of a tenant needs one.
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

const ACTIONS = path.resolve(__dirname, "../../../src/app/actions");

interface Parameter {
    name: string;
    type: string;
    optional: boolean;
}

interface Action {
    file: string;
    name: string;
    parameters: Parameter[];
}

/** The exported async functions of every file of actions, with their parameters as written. */
function actions(): Action[] {
    const found: Action[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".ts")) found.push(...actionsOf(full));
        }
    };
    walk(ACTIONS);
    return found.sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`));
}

function actionsOf(file: string): Action[] {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const found: Action[] = [];
    for (const statement of source.statements) {
        if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
        const modifiers = ts.getModifiers(statement) ?? [];
        if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
        if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) continue;
        found.push({
            file: path.relative(ACTIONS, file).split(path.sep).join("/"),
            name: statement.name.text,
            parameters: statement.parameters.map((parameter) => ({
                name: parameter.name.getText(source),
                type: parameter.type?.getText(source) ?? "",
                optional: Boolean(parameter.questionToken || parameter.initializer),
            })),
        });
    }
    return found;
}

/** The kind of record a parameter named `id` or `ids` stands for, by the name of its action. */
const RECORD_BY_ACTION: [RegExp, readonly string[]][] = [
    [/RetentionPolic/, [G.retention]],
    [/NamingTemplate/, [G.naming]],
    [/SchedulePreset/, [G.schedule]],
    [/NotificationTemplate/, [G.template]],
    [/ExcludePattern/, [G.exclude]],
    [/ApiKey/, [G.apikey]],
    [/EncryptionProfile|MasterKey|EncryptionKey/, [G.key]],
    [/Deleted|Trash|Purge/i, [G.trash]],
    [/Tenant|Invitation/, [G.tenant]],
    [/User/, [G.user]],
    [/Group/, [G.group]],
];

/**
 * Parameters named like an id that name nothing of a tenant, each with why. They get a plain value.
 */
const NOT_A_RECORD: Record<string, string> = {
    accountId: "a sign-in link of the own account",
    sessionId: "a session of an account, which belongs to no tenant",
    tableId: "a table layout of the own account",
    pageId: "a page layout of the own account",
    eventId: "the name of an event, the same in every tenant",
    eventIds: "the names of events, the same in every tenant",
};

/** The ids of the other tenant a parameter that names a record is tried with, empty for any other. */
function recordIds(action: Action, parameter: Parameter): readonly string[] {
    const name = parameter.name;
    if (name in NOT_A_RECORD) return [];
    if (/^groupIds?$/.test(name)) return [G.group];
    if (/^storageConfigId$/.test(name)) return [G.storage];
    if (/^decryptionProfileId$/.test(name)) return [G.key];
    if (/^tenantIds?$/.test(name)) return [G.tenant];
    if (/^userIds?$/.test(name)) return [G.user];
    if (/^sourceIds?$/.test(name)) return [G.source];
    if (/^(configIds?|entryId)$/.test(name)) return [G.source, G.storage, G.channel];
    if (/^destinationIds?$/.test(name)) return [G.storage];
    if (/^channelIds$/.test(name)) return [G.channel];
    if (/^requestId$/.test(name)) return [G.request];
    if (/^recordIds$/.test(name)) return [G.trash];
    if (/^(keyId)$/.test(name)) return [G.apikey];
    if (/^(id|ids|ruleId|providerId)$/.test(name)) {
        return RECORD_BY_ACTION.find(([pattern]) => pattern.test(action.name))?.[1] ?? ALL_IDS;
    }
    return [];
}

/** A plain value for a parameter that names no record, by its name and type. */
function plainValue(parameter: Parameter): unknown {
    const { name, type } = parameter;
    if (/FormData/.test(type)) {
        const form = new FormData();
        for (const [key, value] of Object.entries(POISON)) form.append(key, Array.isArray(value) ? value.join(",") : String(value));
        return form;
    }
    if (/^(on|confirmed|enabled|sharesWithCustomers)$/.test(name) || type === "boolean") return true;
    if (/number/.test(type) && !/[{]/.test(type)) return 1;
    if (/\[\]$/.test(type) && /string/.test(type)) return /event/i.test(name) ? ["backup_success"] : ["probe"];
    if (type === "string" || /^(token|name|newName|description|fingerprint|filePath|databaseName|eventId|tableId|pageId)$/.test(name)) {
        if (/Password$/.test(name) || name === "currentPassword") return "Probe-Password-1!";
        if (name === "keyHex") return "0".repeat(64);
        if (name === "eventId") return "backup_success";
        if (name === "filePath") return "backup.sql";
        return "Probe";
    }
    if (/DeleteMode|TrashKind|ViewMode/.test(type)) return undefined;
    // Anything else is an input object: every field a record can be named by, with an id of Globex.
    return { ...POISON };
}

/** Whether a parameter takes a list, like `ids: string[]`. */
const isList = (parameter: Parameter) => /\[\]$/.test(parameter.type) || /^ids$|Ids$/.test(parameter.name);

/**
 * The calls an action is tried with. The first parameter that names a record takes each id of the
 * other tenant in turn, the others take its first. An action with two such parameters is also
 * tried with the first from the own tenant, like a member of another tenant asked for through it.
 */
function callsOf(action: Action): unknown[][] {
    const ids = action.parameters.map((parameter) => recordIds(action, parameter));
    const named = ids.flatMap((candidates, index) => (candidates.length > 0 ? [index] : []));
    const argsWith = (chosen: Map<number, string>) => action.parameters.map((parameter, index) => {
        if (ids[index].length === 0) return plainValue(parameter);
        const id = chosen.get(index) ?? ids[index][0];
        return isList(parameter) ? [id] : id;
    });
    if (named.length === 0) return [argsWith(new Map())];
    const [subject, second] = named;
    const calls = ids[subject].map((id) => argsWith(new Map([[subject, id]])));
    if (second !== undefined) {
        const own = ids[subject][0].replace(/^globex/, "acme");
        for (const id of ids[second]) calls.push(argsWith(new Map([[subject, own], [second, id]])));
    }
    return calls;
}

/**
 * The data of a result without the ids a bulk action reports as failed, which are the ids it was
 * given and no record it found.
 */
function withoutFailures(data: unknown): unknown {
    if (!data || typeof data !== "object" || Array.isArray(data)) return data;
    return Object.fromEntries(Object.entries(data).filter(([key]) => key !== "failed"));
}

/** What an action returned or threw, as text, with an action that hangs reported as such. */
async function invoke(action: (...args: unknown[]) => Promise<unknown>, args: unknown[]) {
    const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("no answer within 10 s")), 10_000));
    try {
        const result = await Promise.race([action(...args), timeout]);
        return { threw: false, result, text: asText(result) };
    } catch (error) {
        return { threw: true, result: undefined, text: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
}

let db: SweepDatabase;

beforeAll(async () => {
    db = await openSweepDatabase(app, "action-sweep");
}, 120_000);

afterAll(async () => {
    await db?.close();
});

describe("every Server Action", () => {
    it("is found with its parameters", () => {
        const found = actions();
        expect(found.length).toBeGreaterThan(100);
        // Every parameter that names a record gets an id, so none is left with a plain value by accident.
        const unnamed = found.flatMap((action) => action.parameters
            .filter((parameter) => /Ids?$/.test(parameter.name) && !(parameter.name in NOT_A_RECORD) && recordIds(action, parameter).length === 0)
            .map((parameter) => `${action.file} ${action.name}(${parameter.name})`));
        expect(unnamed).toEqual([]);
    });

    it.each(ACTORS)("gives %s nothing of another tenant, and changes or links nothing of it", async (actor) => {
        const before = await rowsOf(db.base, "globex");
        const leaks: string[] = [];
        const answered: string[] = [];
        const outcomes = { succeeded: 0, refused: 0, threw: 0 };
        const thrown: string[] = [];

        for (const action of actions()) {
            const exported = (await import(path.join(ACTIONS, action.file))) as Record<string, (...args: unknown[]) => Promise<unknown>>;
            for (const args of callsOf(action)) {
                db.actAs(actor);
                const label = `${action.file} ${action.name}(${args.map((arg) => (arg instanceof FormData ? "FormData" : asText(arg).slice(0, 60))).join(", ")})`;
                const { threw, result, text } = await invoke(exported[action.name], args);
                if (text.includes(MARK)) leaks.push(`${label} -> ${text.slice(0, 300)}`);
                const success = !threw && (result as { success?: boolean } | undefined)?.success !== false;
                // An action that names a record of the other tenant never hands one out.
                const namesRecord = action.parameters.some((parameter) => recordIds(action, parameter).length > 0);
                if (namesRecord && success && holdsRecords(asText(withoutFailures((result as { data?: unknown } | undefined)?.data ?? null)))) {
                    answered.push(`${label} -> ${text.slice(0, 300)}`);
                }
                if (threw) {
                    outcomes.threw += 1;
                    thrown.push(`${label}: ${text.slice(0, 160)}`);
                } else if (success) outcomes.succeeded += 1;
                else outcomes.refused += 1;
            }
        }

        expect.soft(leaks, "results that hold data of the other tenant").toEqual([]);
        expect.soft(answered, "actions that handed out a record for an id of the other tenant").toEqual([]);
        await expectBoundaryKept(db.base, app, before);
        process.stdout.write(`${actor}: ${JSON.stringify(outcomes)}\n`);
        if (process.env.SWEEP_VERBOSE) process.stdout.write(`${thrown.join("\n")}\n`);
    }, 600_000);
});
