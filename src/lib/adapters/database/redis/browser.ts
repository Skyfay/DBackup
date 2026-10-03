import type { ExecutionHost } from "@/lib/transport";
import { RedisConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { REDIS_CLI, buildConnectionArgs } from "./args";

const SCAN_LIMIT = 200;
/** Keys a filtered read looks through per round, and the rounds at most, so a filter on a big keyspace stays bounded. */
const MATCH_BATCH = 1000;
const MATCH_ROUNDS = 50;

const COLUMNS: ColumnInfo[] = [
    { name: "key", dataType: "string", nullable: false, primaryKey: true },
    { name: "type", dataType: "string", nullable: false },
    { name: "ttl", dataType: "integer", nullable: false },
];

/**
 * Connection args pinned to one database index.
 *
 * buildConnectionArgs omits -n for database 0 because that is redis-cli's
 * default. The browser is always looking at a specific database, so index 0 is
 * stated explicitly here.
 */
function buildArgs(config: RedisConfig, dbIndex: number): string[] {
    const args = buildConnectionArgs({ ...config, database: dbIndex });
    return dbIndex === 0 ? [...args, "-n", "0"] : args;
}

/** Lua script: returns {type}\t{ttl} for each key passed as KEYS array. */
const luaTypesTtl = `local r={} for i,k in ipairs(KEYS) do local t=redis.call('TYPE',k)['ok'] local ttl=redis.call('TTL',k) r[i]=t..'\\t'..tostring(ttl) end return r`;

function toRow({ key, type, ttl }: { key: string; type: string; ttl: number }): Record<string, unknown> {
    return { key, type, ttl: ttl === -1 ? "no expiry" : ttl === -2 ? "expired" : `${ttl}s` };
}

function parseLuaArray(stdout: string): string[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.replace(/^\d+\)\s*"?/, "").replace(/"$/, ""))
        .filter(Boolean);
}

async function getKeyInfo(
    host: ExecutionHost,
    redisCli: string,
    keys: string[],
    cliArgs: string[],
): Promise<Array<{ key: string; type: string; ttl: number }>> {
    if (keys.length === 0) return [];

    // The keys go through as separate arguments, so a key containing a quote or
    // a space cannot break out of the command. The SSH path used to paste them
    // into a shell string.
    const result = await host.exec([
        redisCli, ...cliArgs, "EVAL", luaTypesTtl, String(keys.length), ...keys,
    ]);
    if (result.code !== 0) {
        return keys.map(key => ({ key, type: "unknown", ttl: -1 }));
    }

    const results = parseLuaArray(result.stdout);
    return keys.map((key, i) => {
        const parts = (results[i] ?? "").split("\t");
        return { key, type: parts[0] ?? "unknown", ttl: parseInt(parts[1] ?? "-1", 10) };
    });
}

export async function getTables(config: RedisConfig, database: string, host: ExecutionHost): Promise<TableInfo[]> {
    const dbIndex = parseInt(database, 10);
    const redisCli = await host.which(...REDIS_CLI);
    const cliArgs = buildArgs(config, dbIndex);

    const result = await host.exec([redisCli, ...cliArgs, "DBSIZE"]);
    const rowCount = result.code === 0 ? parseInt(result.stdout.trim(), 10) || 0 : 0;
    return [{ name: "Keys", type: "table", rowCount }];
}

/** Characters MATCH reads as a pattern, escaped so a typed value matches itself. */
function escapeGlob(value: string): string {
    return value.replace(/[\\*?[\]]/g, "\\$&");
}

/** The MATCH pattern of a filter on the key, contains unless the mode says otherwise. */
export function keyPattern(search: string, mode: TableDataOptions["matchMode"]): string {
    const value = escapeGlob(search);
    switch (mode) {
        case "equals":
            return value;
        case "starts":
            return `${value}*`;
        case "ends":
            return `*${value}`;
        default:
            return `*${value}*`;
    }
}

/** A cursor and the keys of one SCAN answer, whose first line is the cursor. */
function parseScan(stdout: string): { cursor: string; keys: string[] } {
    const lines = stdout.split("\n").map(l => l.trim()).filter(Boolean);
    return { cursor: lines[0] ?? "0", keys: lines.slice(1) };
}

/**
 * The keys that match a filter. SCAN looks at a batch of keys at a time and returns the ones
 * that match, so it goes round until it has a page, the keyspace ends or the rounds run out.
 */
async function matchingKeys(host: ExecutionHost, redisCli: string, cliArgs: string[], pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    for (let round = 0; round < MATCH_ROUNDS; round++) {
        const result = await host.exec([redisCli, ...cliArgs, "SCAN", cursor, "MATCH", pattern, "COUNT", String(MATCH_BATCH)]);
        if (result.code !== 0) break;
        const scan = parseScan(result.stdout);
        keys.push(...scan.keys);
        cursor = scan.cursor;
        if (cursor === "0" || keys.length >= SCAN_LIMIT) break;
    }
    return keys.slice(0, SCAN_LIMIT);
}

export async function getTableData(
    config: RedisConfig,
    options: TableDataOptions,
    host: ExecutionHost,
): Promise<TableDataResult> {
    const dbIndex = parseInt(options.database, 10);
    const redisCli = await host.which(...REDIS_CLI);
    const cliArgs = buildArgs(config, dbIndex);

    // A filter only ever reads the key, the one column SCAN can match.
    const search = options.search?.trim();
    if (search && (!options.searchColumn || options.searchColumn === "key")) {
        const keys = await matchingKeys(host, redisCli, cliArgs, keyPattern(search, options.matchMode));
        const keyInfo = await getKeyInfo(host, redisCli, keys, cliArgs);
        return { rows: keyInfo.map(toRow), totalCount: keys.length, columns: COLUMNS };
    }

    const [dbsize, scan] = await Promise.all([
        host.exec([redisCli, ...cliArgs, "DBSIZE"]),
        host.exec([redisCli, ...cliArgs, "SCAN", "0", "COUNT", String(SCAN_LIMIT)]),
    ]);

    const totalCount = dbsize.code === 0 ? parseInt(dbsize.stdout.trim(), 10) || 0 : 0;
    const keys = parseScan(scan.stdout).keys;

    const keyInfo = await getKeyInfo(host, redisCli, keys, cliArgs);
    const rows: Record<string, unknown>[] = keyInfo.map(toRow);

    return { rows, totalCount, columns: COLUMNS };
}
