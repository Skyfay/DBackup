import { execFile } from "child_process";
import util from "util";
import { RedisConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildRedisArgs,
    remoteBinaryCheck,
} from "@/lib/ssh";

const execFileAsync = util.promisify(execFile);

const SCAN_LIMIT = 200;

const COLUMNS: ColumnInfo[] = [
    { name: "key", dataType: "string", nullable: false, primaryKey: true },
    { name: "type", dataType: "string", nullable: false },
    { name: "ttl", dataType: "integer", nullable: false },
];

/** Build redis-cli connection args including database index. */
function buildArgs(config: RedisConfig, dbIndex: number): string[] {
    const args: string[] = [];
    args.push("-h", config.host, "-p", String(config.port));
    if (config.username) args.push("--user", config.username);
    if (config.password) args.push("-a", config.password, "--no-auth-warning");
    if (config.tls) args.push("--tls");
    args.push("-n", String(dbIndex));
    return args;
}

/** Lua script: returns {type}\t{ttl} for each key passed as KEYS array. */
const luaTypesTtl = `local r={} for i,k in ipairs(KEYS) do local t=redis.call('TYPE',k)['ok'] local ttl=redis.call('TTL',k) r[i]=t..'\\t'..tostring(ttl) end return r`;

function parseLuaArray(stdout: string): string[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.replace(/^\d+\)\s*"?/, "").replace(/"$/, ""))
        .filter(Boolean);
}

async function getKeyInfo(
    keys: string[],
    cliArgs: string[]
): Promise<Array<{ key: string; type: string; ttl: number }>> {
    if (keys.length === 0) return [];
    const evalArgs = [...cliArgs, "EVAL", luaTypesTtl, String(keys.length), ...keys];
    const { stdout } = await execFileAsync("redis-cli", evalArgs);
    const results = parseLuaArray(stdout);
    return keys.map((key, i) => {
        const parts = (results[i] ?? "").split("\t");
        return { key, type: parts[0] ?? "unknown", ttl: parseInt(parts[1] ?? "-1", 10) };
    });
}

async function getKeyInfoSsh(
    ssh: SshClient,
    keys: string[],
    redisBin: string,
    cliArgs: string[]
): Promise<Array<{ key: string; type: string; ttl: number }>> {
    if (keys.length === 0) return [];
    const keyArgs = keys.map(k => `'${k.replace(/'/g, "'\\''")}'`).join(" ");
    const cmd = `${redisBin} ${cliArgs.join(" ")} EVAL '${luaTypesTtl.replace(/'/g, "'\\''")}' ${keys.length} ${keyArgs}`;
    const result = await ssh.exec(cmd);
    if (result.code !== 0) {
        return keys.map(key => ({ key, type: "unknown", ttl: -1 }));
    }
    const results = parseLuaArray(result.stdout);
    return keys.map((key, i) => {
        const parts = (results[i] ?? "").split("\t");
        return { key, type: parts[0] ?? "unknown", ttl: parseInt(parts[1] ?? "-1", 10) };
    });
}

export async function getTables(config: RedisConfig, database: string): Promise<TableInfo[]> {
    const dbIndex = parseInt(database, 10);
    const cliArgs = buildArgs(config, dbIndex);

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            const redisBin = await remoteBinaryCheck(ssh, "redis-cli");
            const args = buildRedisArgs(config);
            if (config.tls) args.push("--tls");
            args.push("-n", String(dbIndex));
            const result = await ssh.exec(`${redisBin} ${args.join(" ")} DBSIZE`);
            const rowCount = result.code === 0 ? parseInt(result.stdout.trim(), 10) || 0 : 0;
            return [{ name: "Keys", type: "table", rowCount }];
        } finally {
            ssh.end();
        }
    }

    const { stdout } = await execFileAsync("redis-cli", [...cliArgs, "DBSIZE"]);
    const rowCount = parseInt(stdout.trim(), 10) || 0;
    return [{ name: "Keys", type: "table", rowCount }];
}

export async function getTableData(
    config: RedisConfig,
    options: TableDataOptions
): Promise<TableDataResult> {
    const dbIndex = parseInt(options.database, 10);
    const cliArgs = buildArgs(config, dbIndex);

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            const redisBin = await remoteBinaryCheck(ssh, "redis-cli");
            const args = buildRedisArgs(config);
            if (config.tls) args.push("--tls");
            args.push("-n", String(dbIndex));

            const [dbsizeResult, scanResult] = await Promise.all([
                ssh.exec(`${redisBin} ${args.join(" ")} DBSIZE`),
                ssh.exec(`${redisBin} ${args.join(" ")} SCAN 0 COUNT ${SCAN_LIMIT}`),
            ]);

            const totalCount = dbsizeResult.code === 0 ? parseInt(dbsizeResult.stdout.trim(), 10) || 0 : 0;
            const scanLines = scanResult.stdout.split("\n").map(l => l.trim()).filter(Boolean);
            const keys = scanLines.slice(1); // First line is cursor

            const keyInfo = await getKeyInfoSsh(ssh, keys, redisBin, args);
            const rows: Record<string, unknown>[] = keyInfo.map(({ key, type, ttl }) => ({
                key,
                type,
                ttl: ttl === -1 ? "no expiry" : ttl === -2 ? "expired" : `${ttl}s`,
            }));

            return { rows, totalCount, columns: COLUMNS };
        } finally {
            ssh.end();
        }
    }

    const [dbsizeOut, scanOut] = await Promise.all([
        execFileAsync("redis-cli", [...cliArgs, "DBSIZE"]),
        execFileAsync("redis-cli", [...cliArgs, "SCAN", "0", "COUNT", String(SCAN_LIMIT)]),
    ]);

    const totalCount = parseInt(dbsizeOut.stdout.trim(), 10) || 0;
    const scanLines = scanOut.stdout.split("\n").map(l => l.trim()).filter(Boolean);
    const keys = scanLines.slice(1); // First line is cursor

    const keyInfo = await getKeyInfo(keys, cliArgs);
    const rows: Record<string, unknown>[] = keyInfo.map(({ key, type, ttl }) => ({
        key,
        type,
        ttl: ttl === -1 ? "no expiry" : ttl === -2 ? "expired" : `${ttl}s`,
    }));

    return { rows, totalCount, columns: COLUMNS };
}
