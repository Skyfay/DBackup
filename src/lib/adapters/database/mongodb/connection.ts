import { MongoClient } from "mongodb";
import { MongoDBConfig } from "@/lib/adapters/definitions";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildMongoArgs,
    remoteBinaryCheck,
} from "@/lib/ssh";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ service: "mongodb-connection" });

/**
 * Build MongoDB connection URI from config
 */
function buildConnectionUri(config: MongoDBConfig): string {
    // Backward-compat: honor a stored inline `uri` for sources created before the
    // URI field was deprecated. The UI no longer exposes it; new sources arrive
    // here with host/port + credentials resolved from the vault profile.
    if (config.uri) {
        return config.uri;
    }

    const auth = config.user && config.password
        ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
        : "";
    const authDb = config.authenticationDatabase || "admin";
    const authParam = config.user ? `?authSource=${authDb}` : "";

    return `mongodb://${auth}${config.host}:${config.port}/${authParam}`;
}

export async function test(config: MongoDBConfig): Promise<{ success: boolean; message: string; version?: string }> {
    if (isSSHMode(config)) {
        const sshConfig = extractSshConfig(config)!;
        const ssh = new SshClient();
        try {
            await ssh.connect(sshConfig);
            const mongoshBin = await remoteBinaryCheck(ssh, "mongosh", "mongo");
            const args = buildMongoArgs(config);

            const cmd = `${mongoshBin} ${args.join(" ")} --quiet --eval 'print(db.adminCommand({buildInfo:1}).version)'`;
            const result = await ssh.exec(cmd);

            if (result.code === 0) {
                const version = result.stdout.trim();
                return { success: true, message: "Connection successful (via SSH)", version };
            }
            return { success: false, message: `SSH MongoDB test failed: ${result.stderr}` };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SSH connection failed: ${msg}` };
        } finally {
            ssh.end();
        }
    }

    let client: MongoClient | null = null;

    try {
        const uri = buildConnectionUri(config);
        client = new MongoClient(uri, {
            connectTimeoutMS: 10000,
            serverSelectionTimeoutMS: 10000,
        });

        await client.connect();

        // Ping the database
        const adminDb = client.db("admin");
        await adminDb.command({ ping: 1 });

        // Get server version
        const serverInfo = await adminDb.command({ buildInfo: 1 });
        const version = serverInfo.version || "Unknown";

        return { success: true, message: "Connection successful", version };
    } catch (error: unknown) {
        const err = error as { message?: string };
        return { success: false, message: "Connection failed: " + (err.message || "Unknown error") };
    } finally {
        if (client) {
            await client.close().catch(() => {});
        }
    }
}

export async function getDatabases(config: MongoDBConfig): Promise<string[]> {
    const sysDbs = ["admin", "config", "local"];

    if (isSSHMode(config)) {
        const sshConfig = extractSshConfig(config)!;
        const ssh = new SshClient();
        try {
            await ssh.connect(sshConfig);
            const mongoshBin = await remoteBinaryCheck(ssh, "mongosh", "mongo");
            const args = buildMongoArgs(config);

            // Output JSON array of DB names - single print(), parsed in Node
            const cmd = `${mongoshBin} ${args.join(" ")} --quiet --eval 'print(JSON.stringify(db.adminCommand({listDatabases:1}).databases.map(function(d){return d.name})))'`;
            log.debug("getDatabases SSH command", { cmd: cmd.replace(/--password\s+'[^']*'/, "--password '***'") });
            const result = await ssh.exec(cmd);

            log.debug("getDatabases SSH result", {
                code: result.code,
                stdout: result.stdout.substring(0, 500),
                stderr: result.stderr.substring(0, 500),
            });

            if (result.code !== 0) {
                throw new Error(`Failed to list databases (code ${result.code}): ${result.stderr || result.stdout}`);
            }

            // Parse JSON array from stdout - find the line that looks like a JSON array
            const lines = result.stdout.split('\n').map(s => s.trim()).filter(Boolean);
            const jsonLine = lines.find(l => l.startsWith('['));

            if (jsonLine) {
                const allNames: string[] = JSON.parse(jsonLine);
                return allNames.filter(n => !sysDbs.includes(n));
            }

            // Fallback: treat each non-empty line as a DB name
            return lines.filter(s => s && !sysDbs.includes(s));
        } finally {
            ssh.end();
        }
    }

    let client: MongoClient | null = null;

    try {
        const uri = buildConnectionUri(config);
        client = new MongoClient(uri, {
            connectTimeoutMS: 10000,
            serverSelectionTimeoutMS: 10000,
        });

        await client.connect();

        const adminDb = client.db("admin");
        const result = await adminDb.command({ listDatabases: 1 });

        return result.databases
            .map((db: { name: string }) => db.name)
            .filter((name: string) => !sysDbs.includes(name));
    } catch (error: unknown) {
        const err = error as { message?: string };
        throw new Error("Failed to list databases: " + (err.message || "Unknown error"));
    } finally {
        if (client) {
            await client.close().catch(() => {});
        }
    }
}

import { DatabaseInfo } from "@/lib/core/interfaces";

export async function getDatabasesWithStats(config: MongoDBConfig): Promise<DatabaseInfo[]> {
    const sysDbs = ["admin", "config", "local"];

    if (isSSHMode(config)) {
        const sshConfig = extractSshConfig(config)!;
        const ssh = new SshClient();
        try {
            await ssh.connect(sshConfig);
            const mongoshBin = await remoteBinaryCheck(ssh, "mongosh", "mongo");
            const args = buildMongoArgs(config);

            // Output JSON array with stats - single print(), parsed in Node
            // All filtering done in Node to avoid quoting issues in shell
            const script = `var r=db.adminCommand({listDatabases:1});var out=[];r.databases.forEach(function(d){var c=0;try{c=db.getSiblingDB(d.name).getCollectionNames().length}catch(e){}out.push({name:d.name,size:Number(d.sizeOnDisk)||0,tables:c})});print(JSON.stringify(out))`;
            const cmd = `${mongoshBin} ${args.join(" ")} --quiet --eval '${script}'`;
            log.debug("getDatabasesWithStats SSH command", { cmd: cmd.replace(/--password\s+'[^']*'/, "--password '***'") });
            const result = await ssh.exec(cmd);

            log.debug("getDatabasesWithStats SSH result", {
                code: result.code,
                stdout: result.stdout.substring(0, 500),
                stderr: result.stderr.substring(0, 500),
            });

            if (result.code !== 0) {
                throw new Error(`Failed to get database stats (code ${result.code}): ${result.stderr || result.stdout}`);
            }

            // Parse JSON array from stdout
            const lines = result.stdout.split('\n').map(s => s.trim()).filter(Boolean);
            const jsonLine = lines.find(l => l.startsWith('['));

            if (jsonLine) {
                const parsed: Array<{ name: string; size: number; tables: number }> = JSON.parse(jsonLine);
                return parsed
                    .filter(d => !sysDbs.includes(d.name))
                    .map(d => ({
                        name: d.name,
                        sizeInBytes: d.size,
                        tableCount: d.tables,
                    }));
            }

            // Fallback: tab-separated parsing
            return lines
                .map(line => {
                    const [name, sizeStr, tableStr] = line.split('\t');
                    return {
                        name,
                        sizeInBytes: parseInt(sizeStr, 10) || 0,
                        tableCount: parseInt(tableStr, 10) || 0,
                    };
                })
                .filter(d => d.name && !["admin", "config", "local"].includes(d.name));
        } finally {
            ssh.end();
        }
    }

    let client: MongoClient | null = null;

    try {
        const uri = buildConnectionUri(config);
        client = new MongoClient(uri, {
            connectTimeoutMS: 10000,
            serverSelectionTimeoutMS: 10000,
        });

        await client.connect();

        const adminDb = client.db("admin");
        const result = await adminDb.command({ listDatabases: 1 });

        const sysDbs = ["admin", "config", "local"];
        const databases: DatabaseInfo[] = [];

        for (const db of result.databases) {
            if (sysDbs.includes(db.name)) continue;

            let tableCount: number | undefined;
            try {
                const dbRef = client.db(db.name);
                const collections = await dbRef.listCollections().toArray();
                tableCount = collections.length;
            } catch {
                // Collection count is best-effort
            }

            databases.push({
                name: db.name,
                sizeInBytes: db.sizeOnDisk ?? undefined,
                tableCount,
            });
        }

        return databases;
    } catch (error: unknown) {
        const err = error as { message?: string };
        throw new Error("Failed to list databases with stats: " + (err.message || "Unknown error"));
    } finally {
        if (client) {
            await client.close().catch(() => {});
        }
    }
}
