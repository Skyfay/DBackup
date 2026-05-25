import { PostgresConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildPsqlArgs,
    remoteEnv,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";
import { execFileAsync } from "./connection";

/** Sanitize a PostgreSQL identifier for double-quote quoting. */
function escapePgIdentifier(name: string): string {
    return name.replace(/"/g, '""').replace(/\0/g, "");
}

/** Sanitize a string value for use in a single-quoted SQL literal. */
function escapePgLiteral(value: string): string {
    return value.replace(/'/g, "''").replace(/\0/g, "");
}

const tablesQuery = (db: string) => `
    SELECT t.table_name, t.table_type,
        COALESCE(s.n_live_tup, 0) AS row_estimate,
        COALESCE(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)), 0) AS total_bytes
    FROM information_schema.tables t
    LEFT JOIN pg_stat_user_tables s ON s.schemaname = t.table_schema AND s.relname = t.table_name
    WHERE t.table_catalog = '${escapePgLiteral(db)}'
      AND t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY t.table_schema, t.table_name
`.trim();

const columnsQuery = (db: string, table: string) => `
    SELECT column_name, data_type, is_nullable, CASE WHEN column_name IN (
        SELECT kcu.column_name FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_catalog = '${escapePgLiteral(db)}' AND tc.table_name = '${escapePgLiteral(table)}'
    ) THEN 'PRI' ELSE '' END AS column_key, column_default
    FROM information_schema.columns
    WHERE table_catalog = '${escapePgLiteral(db)}'
      AND table_name = '${escapePgLiteral(table)}'
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY ordinal_position
`.trim();

function parseTablesOutput(stdout: string): TableInfo[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [name, rawType, rowStr, sizeStr] = line.split("\t");
            const type: TableInfo["type"] =
                rawType === "VIEW" ? "view" :
                rawType === "MATERIALIZED VIEW" ? "materialized_view" : "table";
            return {
                name,
                type,
                rowCount: parseInt(rowStr, 10) || 0,
                sizeInBytes: parseInt(sizeStr, 10) || 0,
            };
        });
}

function parseColumnsOutput(stdout: string): ColumnInfo[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [name, dataType, isNullable, columnKey, defaultValue] = line.split("\t");
            return {
                name,
                dataType,
                nullable: isNullable === "YES",
                primaryKey: columnKey === "PRI",
                defaultValue: !defaultValue || defaultValue === "" ? undefined : defaultValue,
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
                const raw = values[i];
                row[col.name] = raw === undefined ? null : raw;
            });
            return row;
        });
}

/** Resolve which database to connect to for admin queries. */
function resolveConnectDb(config: PostgresConfig): string {
    if (typeof config.database === "string" && config.database) return config.database;
    return "postgres";
}

export async function getTables(config: PostgresConfig, database: string): Promise<TableInfo[]> {
    const query = tablesQuery(database);
    const connectDb = database;
    const env: Record<string, string | undefined> = {};
    if (config.password) env.PGPASSWORD = config.password;

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            await remoteBinaryCheck(ssh, "psql");
            const args = buildPsqlArgs(config);
            const cmd = remoteEnv(env, `psql ${args.join(" ")} -d ${shellEscape(connectDb)} -t -A -F '\t' -c ${shellEscape(query)}`);
            const result = await ssh.exec(cmd);
            if (result.code !== 0) throw new Error(`Failed to list tables: ${result.stderr}`);
            return parseTablesOutput(result.stdout);
        } finally {
            ssh.end();
        }
    }

    const psqlEnv = { ...process.env, PGPASSWORD: config.password };
    const args = ["-h", config.host, "-p", String(config.port), "-U", config.user, "-d", connectDb, "-t", "-A", "-F", "\t", "-c", query];
    const { stdout } = await execFileAsync("psql", args, { env: psqlEnv });
    return parseTablesOutput(stdout);
}

export async function getTableData(
    config: PostgresConfig,
    options: TableDataOptions
): Promise<TableDataResult> {
    const { database, table, page, pageSize } = options;
    const offset = (page - 1) * pageSize;
    const tblId = `"${escapePgIdentifier(table)}"`;
    const colQuery = columnsQuery(database, table);
    const countQuery = `SELECT COUNT(*) FROM ${tblId}`;
    const dataQuery = `SELECT * FROM ${tblId} LIMIT ${pageSize} OFFSET ${offset}`;
    const pgEnv = { ...process.env, PGPASSWORD: config.password };
    const envMap: Record<string, string | undefined> = {};
    if (config.password) envMap.PGPASSWORD = config.password;

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            await remoteBinaryCheck(ssh, "psql");
            const args = buildPsqlArgs(config);
            const baseCmd = `psql ${args.join(" ")} -d ${shellEscape(database)} -t -A -F '\t'`;

            const [colResult, countResult, dataResult] = await Promise.all([
                ssh.exec(remoteEnv(envMap, `${baseCmd} -c ${shellEscape(colQuery)}`)),
                ssh.exec(remoteEnv(envMap, `${baseCmd} -c ${shellEscape(countQuery)}`)),
                ssh.exec(remoteEnv(envMap, `${baseCmd} -c ${shellEscape(dataQuery)}`)),
            ]);

            if (colResult.code !== 0) throw new Error(`Column query failed: ${colResult.stderr}`);
            if (countResult.code !== 0) throw new Error(`Count query failed: ${countResult.stderr}`);
            if (dataResult.code !== 0) throw new Error(`Data query failed: ${dataResult.stderr}`);

            const columns = parseColumnsOutput(colResult.stdout);
            const totalCount = parseInt(countResult.stdout.trim(), 10) || 0;
            const rows = parseDataRows(dataResult.stdout, columns);
            return { rows, totalCount, columns };
        } finally {
            ssh.end();
        }
    }

    const baseArgs = ["-h", config.host, "-p", String(config.port), "-U", config.user, "-d", database, "-t", "-A", "-F", "\t"];

    const [colOut, countOut, dataOut] = await Promise.all([
        execFileAsync("psql", [...baseArgs, "-c", colQuery], { env: pgEnv }),
        execFileAsync("psql", [...baseArgs, "-c", countQuery], { env: pgEnv }),
        execFileAsync("psql", [...baseArgs, "-c", dataQuery], { env: pgEnv }),
    ]);

    const columns = parseColumnsOutput(colOut.stdout);
    const totalCount = parseInt(countOut.stdout.trim(), 10) || 0;
    const rows = parseDataRows(dataOut.stdout, columns);
    return { rows, totalCount, columns };
}
