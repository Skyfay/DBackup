/**
 * The test account of Cloudflare D1, reached from the tests themselves to make a database, fill it,
 * read what a restore wrote and delete it again. Nothing of the app is imported here.
 *
 * The account comes from `E2E_D1_ACCOUNT_ID` and `E2E_D1_TOKEN`, which CI sets from the settings
 * of the repository, or from `cloudflareD1` of the lab config. Without either the D1 tests skip,
 * also in CI, since a pull request from a fork gets no secrets.
 */

import { readFileSync } from "fs";
import path from "path";
import { REPO_ROOT } from "../../lab/src/config";
import { lab } from "./environment";

export interface D1Account {
    accountId: string;
    token: string;
}

export function d1Account(): D1Account | null {
    const accountId = process.env.E2E_D1_ACCOUNT_ID || lab.cloudflareD1?.accountId;
    const token = process.env.E2E_D1_TOKEN || lab.cloudflareD1?.token;
    return accountId && token ? { accountId: accountId.toLowerCase(), token } : null;
}

/** A database of a test run older than this is left over from a run that never cleaned up. */
const LEFTOVER_AGE_MS = 2 * 60 * 60 * 1000;

interface Database {
    uuid: string;
    name: string;
    created_at?: string;
}

export class D1 {
    constructor(private readonly account: D1Account) {}

    private async call<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.account.accountId}${apiPath}`, {
            method,
            headers: { Authorization: `Bearer ${this.account.token}`, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await response.json() as { success: boolean; result: T; errors?: { message: string }[] };
        if (!json.success) throw new Error(`Cloudflare ${method} ${apiPath}: ${(json.errors ?? []).map((error) => error.message).join("; ")}`);
        return json.result;
    }

    async list(): Promise<Database[]> {
        return this.call<Database[]>("GET", "/d1/database?per_page=1000");
    }

    async find(name: string): Promise<Database | undefined> {
        return (await this.list()).find((database) => database.name === name);
    }

    /** A new database with the SQLite dataset of the lab. */
    async createShop(name: string): Promise<Database> {
        const database = await this.call<Database>("POST", "/d1/database", { name });
        await this.query(database.uuid, readFileSync(path.join(REPO_ROOT, "lab", "datasets", "sqlite.sql"), "utf8"));
        return database;
    }

    async query<Row = Record<string, unknown>>(uuid: string, sql: string, params?: unknown[]): Promise<Row[]> {
        const results = await this.call<{ results: Row[] }[]>("POST", `/d1/database/${uuid}/query`, params ? { sql, params } : { sql });
        return results[results.length - 1]?.results ?? [];
    }

    async delete(name: string): Promise<void> {
        const database = await this.find(name);
        if (database) await this.call("DELETE", `/d1/database/${database.uuid}`);
    }

    /** Deletes the databases of earlier runs that ended before their cleanup. The free plan holds only a few. */
    async deleteLeftovers(): Promise<void> {
        const now = Date.now();
        for (const database of await this.list()) {
            const age = database.created_at ? now - Date.parse(database.created_at) : 0;
            if (database.name.startsWith("e2e") && age > LEFTOVER_AGE_MS) {
                await this.call("DELETE", `/d1/database/${database.uuid}`).catch(() => undefined);
            }
        }
    }

    /**
     * What a database holds, as text: the schema of every object and every row of every table,
     * each value through quote(), so blobs and large integers compare exactly. Objects of SQLite
     * and of Cloudflare are left out.
     */
    async fingerprint(name: string): Promise<string> {
        const database = await this.find(name);
        if (!database) throw new Error(`No D1 database ${name}`);
        const internal = "name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'";
        const schema = await this.query<{ type: string; name: string; sql: string }>(database.uuid, `SELECT type, name, sql FROM sqlite_master WHERE ${internal} ORDER BY type, name`);
        const lines = schema.map((object) => `${object.type} ${object.name}: ${object.sql}`);
        for (const table of schema.filter((object) => object.type === "table")) {
            const columns = await this.query<{ name: string }>(database.uuid, "SELECT name FROM pragma_table_info(?)", [table.name]);
            const values = columns.map((column) => `quote("${column.name.replace(/"/g, '""')}")`).join(" || '|' || ");
            const rows = await this.query<{ r: string }>(database.uuid, `SELECT ${values} AS r FROM "${table.name.replace(/"/g, '""')}" ORDER BY rowid`);
            lines.push(...rows.map((row) => `${table.name}: ${row.r}`));
        }
        return lines.join("\n");
    }
}
