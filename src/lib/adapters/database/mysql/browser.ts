import type { ExecutionHost } from "@/lib/transport";
import { MySQLConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { MYSQL_CLIENT, buildConnectionArgs, withAuthArgs } from "./args";
import { connectionClientOf } from "./dump-content";
import { escapeMysqlIdentifier, escapeMysqlLiteral } from "./sql-quote";

const tablesQuery = (db: string) => `
    SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, COALESCE(DATA_LENGTH + INDEX_LENGTH, 0)
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = '${escapeMysqlLiteral(db)}'
    ORDER BY TABLE_NAME
`.trim();

const columnsQuery = (db: string, table: string) => `
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = '${escapeMysqlLiteral(db)}' AND TABLE_NAME = '${escapeMysqlLiteral(table)}'
    ORDER BY ORDINAL_POSITION
`.trim();

function parseTablesOutput(stdout: string): TableInfo[] {
    return stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [name, rawType, rowCountStr, sizeStr] = line.split("\t");
            const type: TableInfo["type"] =
                rawType === "VIEW" ? "view" :
                rawType === "BASE TABLE" ? "table" : "table";
            return {
                name,
                type,
                rowCount: parseInt(rowCountStr, 10) || 0,
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
                defaultValue: defaultValue === "\\N" ? undefined : defaultValue,
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
                row[col.name] = raw === "\\N" || raw === undefined ? null : raw;
            });
            return row;
        });
}

export async function getTables(config: MySQLConfig, database: string, host: ExecutionHost): Promise<TableInfo[]> {
    const query = tablesQuery(database);
    const mysqlBin = await host.which(...MYSQL_CLIENT);
    const connArgs = buildConnectionArgs(config, host, { client: await connectionClientOf(config, host, mysqlBin) });

    return withAuthArgs(host, config.password, async (authArgs) => {
        const result = await host.exec([
            mysqlBin, ...authArgs, ...connArgs,
            "-e", query, "--skip-column-names", "--batch",
        ]);
        if (result.code !== 0) {
            throw new Error(`Failed to list tables: ${result.stderr.trim()}`);
        }
        return parseTablesOutput(result.stdout);
    });
}

export async function getTableData(
    config: MySQLConfig,
    options: TableDataOptions,
    host: ExecutionHost,
): Promise<TableDataResult> {
    const { database, table, page, pageSize, sortBy, sortDir, search, searchColumn, matchMode } = options;
    const offset = (page - 1) * pageSize;
    const dbId = escapeMysqlIdentifier(database);
    const tblId = escapeMysqlIdentifier(table);
    const whereClause = (search && searchColumn)
        ? matchMode === "equals"
            ? ` WHERE \`${escapeMysqlIdentifier(searchColumn)}\` = '${escapeMysqlLiteral(search)}'`
            : matchMode === "starts"
            ? ` WHERE \`${escapeMysqlIdentifier(searchColumn)}\` LIKE '${escapeMysqlLiteral(search)}%'`
            : matchMode === "ends"
            ? ` WHERE \`${escapeMysqlIdentifier(searchColumn)}\` LIKE '%${escapeMysqlLiteral(search)}'`
            : ` WHERE \`${escapeMysqlIdentifier(searchColumn)}\` LIKE '%${escapeMysqlLiteral(search)}%'`
        : "";
    const sortClause = sortBy
        ? ` ORDER BY \`${escapeMysqlIdentifier(sortBy)}\` ${sortDir === "desc" ? "DESC" : "ASC"}`
        : "";
    const countQuery = `SELECT COUNT(*) FROM \`${dbId}\`.\`${tblId}\`${whereClause}`;
    const dataQuery = `SELECT * FROM \`${dbId}\`.\`${tblId}\`${whereClause}${sortClause} LIMIT ${pageSize} OFFSET ${offset}`;
    const colQuery = columnsQuery(database, table);

    const mysqlBin = await host.which(...MYSQL_CLIENT);
    const connArgs = buildConnectionArgs(config, host, { client: await connectionClientOf(config, host, mysqlBin) });

    return withAuthArgs(host, config.password, async (authArgs) => {
        const base = [mysqlBin, ...authArgs, ...connArgs, "--skip-column-names", "--batch"];

        // Three concurrent queries. Over SSH each one is a separate channel, which
        // the transport caps so a wide fan-out cannot exhaust the server session limit.
        const [colResult, countResult, dataResult] = await Promise.all([
            host.exec([...base, "-e", colQuery]),
            host.exec([...base, "-e", countQuery]),
            host.exec([...base, "-e", dataQuery]),
        ]);

        if (colResult.code !== 0) throw new Error(`Column query failed: ${colResult.stderr.trim()}`);
        if (countResult.code !== 0) throw new Error(`Count query failed: ${countResult.stderr.trim()}`);
        if (dataResult.code !== 0) throw new Error(`Data query failed: ${dataResult.stderr.trim()}`);

        const columns = parseColumnsOutput(colResult.stdout);
        const totalCount = parseInt(countResult.stdout.trim(), 10) || 0;
        const rows = parseDataRows(dataResult.stdout, columns);

        return { rows, totalCount, columns };
    });
}
