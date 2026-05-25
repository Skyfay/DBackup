import { execFile } from "child_process";
import { promisify } from "util";
import { SshClient, shellEscape, extractSqliteSshConfig, remoteBinaryCheck } from "@/lib/ssh";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";

const execFileAsync = promisify(execFile);

/** Sanitize a SQLite identifier for double-quote quoting. */
function escapeIdentifier(name: string): string {
    return name.replace(/"/g, '""').replace(/\0/g, "");
}

/** Parse PRAGMA table_info output (pipe-separated: cid|name|type|notnull|dflt_value|pk). */
function parsePragmaTableInfo(stdout: string): ColumnInfo[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const parts = line.split("|");
            return {
                name: parts[1] ?? "",
                dataType: parts[2] ?? "TEXT",
                nullable: parts[3] === "0",
                primaryKey: parts[5] === "1",
                defaultValue: parts[4] && parts[4] !== "" ? parts[4] : undefined,
            };
        });
}

function parseDataRows(
    stdout: string,
    columns: ColumnInfo[]
): Record<string, unknown>[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const values = line.split("\t");
            const row: Record<string, unknown> = {};
            columns.forEach((col, i) => {
                row[col.name] = values[i] ?? null;
            });
            return row;
        });
}

export async function getTables(config: Record<string, unknown>, _database: string): Promise<TableInfo[]> {
    const dbPath = config.path as string;
    const mode = (config.mode as string) || "local";
    const binaryPath = (config.sqliteBinaryPath as string) || "sqlite3";
    const query = `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name;`;

    if (mode === "ssh") {
        const sshConfig = extractSqliteSshConfig(config);
        if (!sshConfig) throw new Error("SSH host and username are required");

        const client = new SshClient();
        try {
            await client.connect(sshConfig);
            const bin = await remoteBinaryCheck(client, binaryPath);
            const result = await client.exec(`${shellEscape(bin)} ${shellEscape(dbPath)} ${shellEscape(query)}`);
            if (result.code !== 0) throw new Error(`Failed to list tables: ${result.stderr}`);
            return result.stdout
                .split("\n")
                .map(l => l.trim())
                .filter(Boolean)
                .map(line => {
                    const [name, rawType] = line.split("|");
                    return { name, type: rawType === "view" ? "view" as const : "table" as const };
                });
        } finally {
            client.end();
        }
    }

    const { stdout } = await execFileAsync(binaryPath, [dbPath, query]);
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [name, rawType] = line.split("|");
            return { name, type: rawType === "view" ? "view" as const : "table" as const };
        });
}

export async function getTableData(
    config: Record<string, unknown>,
    options: TableDataOptions
): Promise<TableDataResult> {
    const { table, page, pageSize } = options;
    const offset = (page - 1) * pageSize;
    const dbPath = config.path as string;
    const mode = (config.mode as string) || "local";
    const binaryPath = (config.sqliteBinaryPath as string) || "sqlite3";
    const tblId = `"${escapeIdentifier(table)}"`;
    const pragmaQuery = `PRAGMA table_info(${tblId});`;
    const countQuery = `SELECT COUNT(*) FROM ${tblId};`;
    const dataQuery = `SELECT * FROM ${tblId} LIMIT ${pageSize} OFFSET ${offset};`;

    if (mode === "ssh") {
        const sshConfig = extractSqliteSshConfig(config);
        if (!sshConfig) throw new Error("SSH host and username are required");

        const client = new SshClient();
        try {
            await client.connect(sshConfig);
            const bin = await remoteBinaryCheck(client, binaryPath);
            const dbArg = shellEscape(dbPath);

            const [pragmaResult, countResult, dataResult] = await Promise.all([
                client.exec(`${shellEscape(bin)} ${dbArg} ${shellEscape(pragmaQuery)}`),
                client.exec(`${shellEscape(bin)} ${dbArg} ${shellEscape(countQuery)}`),
                client.exec(`${shellEscape(bin)} -separator '\t' ${dbArg} ${shellEscape(dataQuery)}`),
            ]);

            if (pragmaResult.code !== 0) throw new Error(`Schema query failed: ${pragmaResult.stderr}`);
            if (countResult.code !== 0) throw new Error(`Count query failed: ${countResult.stderr}`);
            if (dataResult.code !== 0) throw new Error(`Data query failed: ${dataResult.stderr}`);

            const columns = parsePragmaTableInfo(pragmaResult.stdout);
            const totalCount = parseInt(countResult.stdout.trim(), 10) || 0;
            const rows = parseDataRows(dataResult.stdout, columns);
            return { rows, totalCount, columns };
        } finally {
            client.end();
        }
    }

    const [pragmaOut, countOut, dataOut] = await Promise.all([
        execFileAsync(binaryPath, [dbPath, pragmaQuery]),
        execFileAsync(binaryPath, [dbPath, countQuery]),
        execFileAsync(binaryPath, ["-separator", "\t", dbPath, dataQuery]),
    ]);

    const columns = parsePragmaTableInfo(pragmaOut.stdout);
    const totalCount = parseInt(countOut.stdout.trim(), 10) || 0;
    const rows = parseDataRows(dataOut.stdout, columns);
    return { rows, totalCount, columns };
}
