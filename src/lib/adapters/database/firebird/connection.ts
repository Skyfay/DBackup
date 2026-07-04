import { spawn } from "child_process";
import net from "net";
import { FirebirdConfig } from "@/lib/adapters/definitions";
import { DatabaseInfo } from "@/lib/core/interfaces";
import { getIsqlCommand } from "./tools";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    remoteEnv,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";

/**
 * Resolve a job-selected alias name (config.database) to its configured
 * filesystem path (config.databases). Firebird has no server-side database
 * registry, so this is the single point where an alias becomes a real path.
 */
export function resolveAliasPath(config: FirebirdConfig, aliasName: string): string {
    const entry = (config.databases || []).find((d) => d.name === aliasName);
    if (!entry) {
        const known = (config.databases || []).map((d) => d.name).join(", ") || "(none)";
        throw new Error(`Unknown Firebird database alias "${aliasName}". Configured aliases: ${known}.`);
    }
    return entry.path;
}

/**
 * Build the connection string gbak/isql use to reach a database.
 * Direct mode: the tool runs in the DBackup container and connects over the
 * Firebird wire protocol to the remote server ("host[/port]:path").
 * SSH mode: the tool runs on the target itself, so the bare local path is used.
 */
export function buildConnectionString(config: FirebirdConfig, dbPath: string): string {
    if (isSSHMode(config)) return dbPath;
    const portSegment = config.port && config.port !== 3050 ? `/${config.port}` : "";
    return `${config.host}${portSegment}:${dbPath}`;
}

export async function getDatabases(config: FirebirdConfig): Promise<string[]> {
    return (config.databases || []).map((d) => d.name);
}

export async function getDatabasesWithStats(config: FirebirdConfig): Promise<DatabaseInfo[]> {
    // No live server query - direct mode can't stat a remote path by filesystem,
    // so sizes are intentionally left undefined. The restore UI tolerates this.
    // `path` is included so the restore UI can prefill the target field with the
    // real path instead of just the alias name.
    return (config.databases || []).map((d) => ({ name: d.name, path: d.path }));
}

const VERSION_QUERY = "SELECT rdb$get_context('SYSTEM','ENGINE_VERSION') FROM rdb$database;";

function parseEngineVersion(raw: string): string | undefined {
    const match = raw.match(/(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : undefined;
}

function runIsqlQuery(
    bin: string,
    args: string[],
    sql: string,
    env: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args, { env });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("error", reject);
        proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        proc.stdin.write(sql + "\n");
        proc.stdin.end();
    });
}

export async function test(config: FirebirdConfig): Promise<{ success: boolean; message: string; version?: string }> {
    const aliases = config.databases || [];
    if (aliases.length === 0) {
        return { success: false, message: "No database aliases configured" };
    }
    const dbPath = aliases[0].path;

    if (isSSHMode(config)) {
        const sshConfig = extractSshConfig(config)!;
        const ssh = new SshClient();
        try {
            await ssh.connect(sshConfig);
            const isqlBin = await remoteBinaryCheck(ssh, "isql", "isql-fb");
            const connStr = buildConnectionString(config, dbPath);
            const cmd = remoteEnv(
                { ISC_PASSWORD: config.password },
                `echo ${shellEscape(VERSION_QUERY)} | ${isqlBin} -q ${shellEscape(connStr)} -user ${shellEscape(config.user)}`
            );
            const result = await ssh.exec(cmd);
            if (result.code !== 0) {
                return { success: false, message: `SSH connection failed: ${result.stderr.trim() || result.stdout.trim()}` };
            }
            return { success: true, message: "Connection successful (via SSH)", version: parseEngineVersion(result.stdout) };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SSH connection failed: ${msg}` };
        } finally {
            ssh.end();
        }
    }

    const connStr = buildConnectionString(config, dbPath);
    const env = { ...process.env, ISC_PASSWORD: config.password };

    try {
        const result = await runIsqlQuery(getIsqlCommand(), ["-q", connStr, "-user", config.user], VERSION_QUERY, env);
        if (result.code !== 0) {
            return { success: false, message: `Connection failed: ${result.stderr.trim() || result.stdout.trim()}` };
        }
        return { success: true, message: "Connection successful", version: parseEngineVersion(result.stdout) };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Connection failed: ${msg}` };
    }
}

/** Lightweight connectivity check (TCP/SSH connect only, no query) for the periodic health check. */
export async function ping(config: FirebirdConfig): Promise<{ success: boolean; message: string }> {
    if (isSSHMode(config)) {
        const sshConfig = extractSshConfig(config)!;
        const ssh = new SshClient();
        try {
            await ssh.connect(sshConfig);
            return { success: true, message: "SSH connection successful" };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SSH connection failed: ${msg}` };
        } finally {
            ssh.end();
        }
    }

    return new Promise((resolve) => {
        const socket = net.createConnection({ host: config.host, port: config.port || 3050, timeout: 5000 });
        socket.on("connect", () => {
            socket.end();
            resolve({ success: true, message: "TCP connection successful" });
        });
        socket.on("timeout", () => {
            socket.destroy();
            resolve({ success: false, message: "Connection timed out" });
        });
        socket.on("error", (err) => {
            resolve({ success: false, message: `Connection failed: ${err.message}` });
        });
    });
}
