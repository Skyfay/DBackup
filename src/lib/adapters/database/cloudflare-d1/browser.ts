import type { ColumnInfo, DatabaseAdapter, TableInfo } from "@/lib/core/interfaces";
import { ValidationError } from "@/lib/logging/errors";
import { query, rawQuery, requireDatabase, type D1Connection } from "./api";
import { INTERNAL_OBJECT_FILTER, quoteIdentifier } from "./sql";

/**
 * The Database Explorer of a D1 database, through the query API. Every call is a query on the
 * database of the customer and counts against its rows read, and nothing here writes.
 *
 * Values go in as parameters, names only after `sqlite_master` and `pragma_table_info` listed them,
 * so a name never reaches the SQL text that the database does not know. The API answers numbers
 * as JavaScript numbers, which round an integer beyond 2^53, so such an integer is read as text.
 */

/** 2^53 - 1, the largest integer a JavaScript number holds exactly. */
const SAFE = "9007199254740991";

/** The most rows one page shows, whatever the caller asks. */
const MAX_PAGE_SIZE = 500;

const LISTED = `type IN ('table', 'view') AND ${INTERNAL_OBJECT_FILTER}`;

export const getTables: NonNullable<DatabaseAdapter["getTables"]> = async (config, database) => {
    const connection = config as D1Connection;
    const db = await requireDatabase(connection, database, "browse");
    const [objects] = await query<{ name: string; type: string }>(connection, db.uuid, `SELECT name, type FROM sqlite_master WHERE ${LISTED} ORDER BY name`);
    const tables: TableInfo[] = (objects?.results ?? []).map((object) => ({ name: object.name, type: object.type === "view" ? "view" : "table" }));

    const names = tables.filter((table) => table.type === "table").map((table) => table.name);
    if (names.length === 0) return tables;

    // One statement for every count, by position, so no table name becomes an alias.
    const counts = names.map((name) => `SELECT count(*) AS n FROM ${quoteIdentifier(name)}`).join(" UNION ALL ");
    try {
        const [result] = await query<{ n: number }>(connection, db.uuid, counts);
        const rows = result?.results ?? [];
        const byName = new Map(names.map((name, index) => [name, Number(rows[index]?.n)]));
        return tables.map((table) => (byName.has(table.name) && Number.isFinite(byName.get(table.name)) ? { ...table, rowCount: byName.get(table.name) } : table));
    } catch {
        // A virtual table can refuse a count. The list without counts is still useful.
        return tables;
    }
};

/** The columns of a listed table or view, refused for a name `sqlite_master` does not list. */
async function columnsOf(connection: D1Connection, uuid: string, table: string): Promise<ColumnInfo[]> {
    const [listed] = await query<{ n: number }>(connection, uuid, `SELECT count(*) AS n FROM sqlite_master WHERE ${LISTED} AND name = ?`, [table]);
    if (!Number(listed?.results?.[0]?.n)) {
        throw new ValidationError("This table does not exist in the database.", { field: "table" });
    }
    const [info] = await query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(
        connection,
        uuid,
        "SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?)",
        [table],
    );
    return (info?.results ?? []).map((column) => ({
        name: column.name,
        dataType: column.type || "ANY",
        nullable: !column.notnull,
        primaryKey: Number(column.pk) > 0,
        defaultValue: column.dflt_value ?? undefined,
    }));
}

/** A column as the page shows it: a large integer as text, a BLOB as hex. */
function shownValue(column: string): string {
    const col = quoteIdentifier(column);
    return `CASE WHEN typeof(${col}) = 'integer' AND (${col} > ${SAFE} OR ${col} < -${SAFE}) THEN CAST(${col} AS TEXT) WHEN typeof(${col}) = 'blob' THEN 'x''' || hex(${col}) || '''' ELSE ${col} END`;
}

export const getTableData: NonNullable<DatabaseAdapter["getTableData"]> = async (config, options) => {
    const connection = config as D1Connection;
    const { database, table, page, sortBy, sortDir, search, searchColumn, matchMode } = options;
    const pageSize = Math.min(Math.max(Math.floor(options.pageSize) || 50, 1), MAX_PAGE_SIZE);
    const offset = (Math.max(Math.floor(page) || 1, 1) - 1) * pageSize;

    const db = await requireDatabase(connection, database, "browse");
    const columns = await columnsOf(connection, db.uuid, table);
    const known = new Set(columns.map((column) => column.name));
    for (const name of [searchColumn, sortBy]) {
        if (name && !known.has(name)) throw new ValidationError("This column does not exist in the table.");
    }

    const params: unknown[] = [];
    let where = "";
    if (search && searchColumn) {
        const col = quoteIdentifier(searchColumn);
        if (matchMode === "equals") {
            where = ` WHERE ${col} = ?`;
            params.push(search);
        } else {
            where = ` WHERE ${col} LIKE ?`;
            params.push(matchMode === "starts" ? `${search}%` : matchMode === "ends" ? `%${search}` : `%${search}%`);
        }
    }
    const order = sortBy ? ` ORDER BY ${quoteIdentifier(sortBy)} ${sortDir === "desc" ? "DESC" : "ASC"}` : "";
    const from = ` FROM ${quoteIdentifier(table)}${where}`;

    const [countResult] = await query<{ n: number }>(connection, db.uuid, `SELECT count(*) AS n${from}`, params.length ? params : undefined);
    const select = columns.length > 0 ? columns.map((column) => shownValue(column.name)).join(", ") : "*";
    const [data] = await rawQuery(connection, db.uuid, `SELECT ${select}${from}${order} LIMIT ${pageSize} OFFSET ${offset}`, params.length ? params : undefined);

    const names = columns.length > 0 ? columns.map((column) => column.name) : data?.results?.columns ?? [];
    const rows = (data?.results?.rows ?? []).map((values) => Object.fromEntries(names.map((name, index) => [name, values[index] ?? null])));
    return { rows, totalCount: Number(countResult?.results?.[0]?.n) || 0, columns };
};
