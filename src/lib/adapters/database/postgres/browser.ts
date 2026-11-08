import type { ExecutionHost } from "@/lib/transport";
import { PostgresConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { PSQL, buildConnectionArgs, pgEnv, dbArg } from "./args";

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

export async function getTables(config: PostgresConfig, database: string, host: ExecutionHost): Promise<TableInfo[]> {
    const psql = await host.which(...PSQL);
    const result = await host.exec(
        [psql, ...buildConnectionArgs(config), "-d", dbArg(database), "-t", "-A", "-F", "\t", "-c", tablesQuery(database)],
        { env: pgEnv(config.password) },
    );
    if (result.code !== 0) {
        throw new Error(`Failed to list tables: ${result.stderr.trim()}`);
    }
    return parseTablesOutput(result.stdout);
}

export async function getTableData(
    config: PostgresConfig,
    options: TableDataOptions,
    host: ExecutionHost,
): Promise<TableDataResult> {
    const { database, table, page, pageSize, sortBy, sortDir, search, searchColumn, matchMode } = options;
    const offset = (page - 1) * pageSize;
    const tblId = `"${escapePgIdentifier(table)}"`;
    const whereClause = (search && searchColumn)
        ? matchMode === "equals"
            ? ` WHERE "${escapePgIdentifier(searchColumn)}"::text = '${escapePgLiteral(search)}'`
            : matchMode === "starts"
            ? ` WHERE "${escapePgIdentifier(searchColumn)}"::text ILIKE '${escapePgLiteral(search)}%'`
            : matchMode === "ends"
            ? ` WHERE "${escapePgIdentifier(searchColumn)}"::text ILIKE '%${escapePgLiteral(search)}'`
            : ` WHERE "${escapePgIdentifier(searchColumn)}"::text ILIKE '%${escapePgLiteral(search)}%'`
        : "";
    const sortClause = sortBy
        ? ` ORDER BY "${escapePgIdentifier(sortBy)}" ${sortDir === "desc" ? "DESC" : "ASC"} NULLS LAST`
        : "";

    const colQuery = columnsQuery(database, table);
    const countQuery = `SELECT COUNT(*) FROM ${tblId}${whereClause}`;
    const dataQuery = `SELECT * FROM ${tblId}${whereClause}${sortClause} LIMIT ${pageSize} OFFSET ${offset}`;

    const psql = await host.which(...PSQL);
    const base = [psql, ...buildConnectionArgs(config), "-d", dbArg(database), "-t", "-A", "-F", "\t"];
    const env = pgEnv(config.password);

    // Three concurrent queries. Over SSH each one is a separate channel, which
    // the transport caps so a wide fan-out cannot exhaust the server session limit.
    const [colResult, countResult, dataResult] = await Promise.all([
        host.exec([...base, "-c", colQuery], { env }),
        host.exec([...base, "-c", countQuery], { env }),
        host.exec([...base, "-c", dataQuery], { env }),
    ]);

    if (colResult.code !== 0) throw new Error(`Column query failed: ${colResult.stderr.trim()}`);
    if (countResult.code !== 0) throw new Error(`Count query failed: ${countResult.stderr.trim()}`);
    if (dataResult.code !== 0) throw new Error(`Data query failed: ${dataResult.stderr.trim()}`);

    const columns = parseColumnsOutput(colResult.stdout);
    const totalCount = parseInt(countResult.stdout.trim(), 10) || 0;
    const rows = parseDataRows(dataResult.stdout, columns);
    return { rows, totalCount, columns };
}
