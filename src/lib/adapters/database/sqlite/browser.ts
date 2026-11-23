import type { ExecutionHost } from "@/lib/transport";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { ValidationError } from "@/lib/logging/errors";

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

/** Sanitize a SQLite string value for use in a single-quoted SQL literal. */
function escapeSqliteLiteral(value: string): string {
    return value.replace(/'/g, "''").replace(/\0/g, "");
}

export async function getTables(
    config: Record<string, unknown>,
    _database: string,
    host: ExecutionHost,
): Promise<TableInfo[]> {
    const dbPath = config.path as string;
    const binary = await host.which((config.sqliteBinaryPath as string) || "sqlite3");
    const query = "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name;";

    const result = await host.exec([binary, dbPath, query]);
    if (result.code !== 0) {
        throw new Error(`Failed to list tables: ${result.stderr.trim()}`);
    }

    const tables: TableInfo[] = result.stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const [name, rawType] = line.split("|");
            return { name, type: rawType === "view" ? "view" as const : "table" as const };
        });

    return enrichWithRowCounts(host, binary, dbPath, tables);
}

async function enrichWithRowCounts(
    host: ExecutionHost,
    binary: string,
    dbPath: string,
    tables: TableInfo[],
): Promise<TableInfo[]> {
    const tableNames = tables.filter(t => t.type === "table").map(t => t.name);
    if (tableNames.length === 0) return tables;

    const countQuery = tableNames
        .map(name => `SELECT count(*) FROM "${escapeIdentifier(name)}"`)
        .join(" UNION ALL ");

    const result = await host.exec([binary, dbPath, `${countQuery};`]);
    if (result.code !== 0) return tables;

    const rowCounts = new Map<string, number>();
    result.stdout.split("\n").map(l => l.trim()).filter(Boolean).forEach((line, i) => {
        if (i < tableNames.length) {
            const count = parseInt(line, 10);
            if (!isNaN(count)) rowCounts.set(tableNames[i], count);
        }
    });

    return tables.map(t => (t.type === "table" && rowCounts.has(t.name) ? { ...t, rowCount: rowCounts.get(t.name) } : t));
}

/** The tables and views a read takes, the ones `getTables` lists. */
const LISTED = "type IN ('table','view') AND name NOT LIKE 'sqlite_%'";

/**
 * Refuses a table the database file does not list and a column that table does not have, before any
 * statement names them. Quoting keeps a name an identifier, but the sqlite3 program knows relations
 * that are no table of the file: `fsdir` reads the files and folders of the machine it runs on,
 * `sqlite_dbpage` and the `pragma_` functions read around the tables, and `-safe` leaves `fsdir` on.
 * So a name counts only when `sqlite_master` lists it as a table or view. A view cannot reach such
 * a relation itself, sqlite3 refuses that as an unsafe use.
 *
 * The names are compared inside the database, as values, without regard to case like SQLite itself
 * resolves them, so a name with a line break or a separator needs no parsing here.
 *
 * @throws ValidationError for a table or a column the file does not list.
 */
async function assertListed(
    host: ExecutionHost,
    binary: string,
    dbPath: string,
    table: string,
    columns: Array<string | undefined>,
): Promise<void> {
    const asked = columns.filter((column): column is string => !!column);
    const tbl = escapeSqliteLiteral(table);
    const counts = [
        `(SELECT count(*) FROM sqlite_master WHERE ${LISTED} AND name = '${tbl}' COLLATE NOCASE)`,
        ...asked.map((column) => `(SELECT count(*) FROM pragma_table_info('${tbl}') WHERE name = '${escapeSqliteLiteral(column)}' COLLATE NOCASE)`),
    ];
    const result = await host.exec([binary, dbPath, `SELECT ${counts.join(", ")};`]);
    if (result.code !== 0) throw new Error(`Schema query failed: ${result.stderr.trim()}`);

    const found = result.stdout.trim().split("|").map((count) => parseInt(count, 10) > 0);
    if (found.length !== counts.length || !found[0]) {
        throw new ValidationError("This table does not exist in the database.", { field: "table" });
    }
    if (found.includes(false)) {
        throw new ValidationError("This column does not exist in the table.");
    }
}

export async function getTableData(
    config: Record<string, unknown>,
    options: TableDataOptions,
    host: ExecutionHost,
): Promise<TableDataResult> {
    const { table, page, pageSize, sortBy, sortDir, search, searchColumn, matchMode } = options;
    const offset = (page - 1) * pageSize;
    const dbPath = config.path as string;
    const tblId = `"${escapeIdentifier(table)}"`;
    const whereClause = (search && searchColumn)
        ? matchMode === "equals"
            ? ` WHERE "${escapeIdentifier(searchColumn)}" = '${escapeSqliteLiteral(search)}'`
            : matchMode === "starts"
            ? ` WHERE "${escapeIdentifier(searchColumn)}" LIKE '${escapeSqliteLiteral(search)}%'`
            : matchMode === "ends"
            ? ` WHERE "${escapeIdentifier(searchColumn)}" LIKE '%${escapeSqliteLiteral(search)}'`
            : ` WHERE "${escapeIdentifier(searchColumn)}" LIKE '%${escapeSqliteLiteral(search)}%'`
        : "";
    const sortClause = sortBy
        ? ` ORDER BY "${escapeIdentifier(sortBy)}" ${sortDir === "desc" ? "DESC" : "ASC"}`
        : "";
    const pragmaQuery = `PRAGMA table_info(${tblId});`;
    const countQuery = `SELECT COUNT(*) FROM ${tblId}${whereClause};`;
    const dataQuery = `SELECT * FROM ${tblId}${whereClause}${sortClause} LIMIT ${pageSize} OFFSET ${offset};`;

    const binary = await host.which((config.sqliteBinaryPath as string) || "sqlite3");
    await assertListed(host, binary, dbPath, table, [searchColumn, sortBy]);

    // Three concurrent queries. Over SSH each one is a separate channel, which
    // the transport caps so a wide fan-out cannot exhaust the server session limit.
    const [pragmaResult, countResult, dataResult] = await Promise.all([
        host.exec([binary, dbPath, pragmaQuery]),
        host.exec([binary, dbPath, countQuery]),
        host.exec([binary, "-separator", "\t", dbPath, dataQuery]),
    ]);

    if (pragmaResult.code !== 0) throw new Error(`Schema query failed: ${pragmaResult.stderr.trim()}`);
    if (countResult.code !== 0) throw new Error(`Count query failed: ${countResult.stderr.trim()}`);
    if (dataResult.code !== 0) throw new Error(`Data query failed: ${dataResult.stderr.trim()}`);

    const columns = parsePragmaTableInfo(pragmaResult.stdout);
    const totalCount = parseInt(countResult.stdout.trim(), 10) || 0;
    const rows = parseDataRows(dataResult.stdout, columns);
    return { rows, totalCount, columns };
}
