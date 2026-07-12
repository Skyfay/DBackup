import { FirebirdConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { runQuery } from "./connection";

/** Sanitize a Firebird identifier (table/column name) for use in double-quoted SQL. */
function escapeFirebirdIdentifier(name: string): string {
    return name.replace(/"/g, '""').replace(/\0/g, "");
}
/** Sanitize a Firebird string value for use in a single-quoted SQL literal. */
function escapeFirebirdLiteral(value: string): string {
    return value.replace(/'/g, "''").replace(/\0/g, "");
}

const PREAMBLE = "SET HEADING OFF;\n";

const TABLES_QUERY = `
${PREAMBLE}SELECT TRIM(r.RDB$RELATION_NAME) || ASCII_CHAR(9) ||
       CASE WHEN r.RDB$VIEW_BLR IS NULL THEN 'TABLE' ELSE 'VIEW' END
FROM RDB$RELATIONS r
WHERE r.RDB$SYSTEM_FLAG = 0 OR r.RDB$SYSTEM_FLAG IS NULL
ORDER BY 1;
`.trim();

const columnsQuery = (table: string) => `
${PREAMBLE}SELECT TRIM(rf.RDB$FIELD_NAME) || ASCII_CHAR(9) ||
       f.RDB$FIELD_TYPE || ASCII_CHAR(9) ||
       COALESCE(f.RDB$FIELD_SUB_TYPE, 0) || ASCII_CHAR(9) ||
       COALESCE(f.RDB$FIELD_LENGTH, 0) || ASCII_CHAR(9) ||
       COALESCE(f.RDB$FIELD_PRECISION, 0) || ASCII_CHAR(9) ||
       COALESCE(f.RDB$FIELD_SCALE, 0) || ASCII_CHAR(9) ||
       CASE WHEN rf.RDB$NULL_FLAG = 1 THEN 'N' ELSE 'Y' END || ASCII_CHAR(9) ||
       CASE WHEN EXISTS (
           SELECT 1 FROM RDB$RELATION_CONSTRAINTS rc
           JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
           WHERE rc.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
             AND rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'
             AND s.RDB$FIELD_NAME = rf.RDB$FIELD_NAME
       ) THEN 'PRI' ELSE '' END
FROM RDB$RELATION_FIELDS rf
JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
WHERE rf.RDB$RELATION_NAME = '${escapeFirebirdLiteral(table)}'
ORDER BY rf.RDB$FIELD_POSITION;
`.trim();

/** Maps a Firebird RDB$FIELDS type code to a human-readable SQL type name. */
function mapFirebirdType(fieldType: number, subType: number, length: number, precision: number, scale: number): string {
    if ((fieldType === 7 || fieldType === 8 || fieldType === 16) && scale < 0) {
        if (subType === 1) return `NUMERIC(${precision},${-scale})`;
        if (subType === 2) return `DECIMAL(${precision},${-scale})`;
    }
    switch (fieldType) {
        case 7: return "SMALLINT";
        case 8: return "INTEGER";
        case 10: return "FLOAT";
        case 12: return "DATE";
        case 13: return "TIME";
        case 14: return `CHAR(${length})`;
        case 16: return "BIGINT";
        case 23: return "BOOLEAN";
        case 26: return "INT128";
        case 27: return "DOUBLE PRECISION";
        case 35: return "TIMESTAMP";
        case 37: return `VARCHAR(${length})`;
        case 261: return subType === 1 ? "BLOB SUB_TYPE TEXT" : "BLOB";
        default: return `TYPE_${fieldType}`;
    }
}

function parseTablesOutput(stdout: string): TableInfo[] {
    return stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
            const [name, rawType] = line.split("\t").map((s) => s.trim());
            return {
                name,
                type: rawType === "VIEW" ? "view" : "table",
            } as TableInfo;
        });
}

function parseColumnsOutput(stdout: string): ColumnInfo[] {
    return stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
            const [name, typeStr, subTypeStr, lengthStr, precisionStr, scaleStr, nullableFlag, pk] =
                line.split("\t").map((s) => s.trim());
            return {
                name,
                dataType: mapFirebirdType(
                    parseInt(typeStr, 10) || 0,
                    parseInt(subTypeStr, 10) || 0,
                    parseInt(lengthStr, 10) || 0,
                    parseInt(precisionStr, 10) || 0,
                    parseInt(scaleStr, 10) || 0
                ),
                nullable: nullableFlag === "Y",
                primaryKey: pk === "PRI",
            };
        });
}

/**
 * Parses isql's `SET LIST ON` output ("COLUMN_NAME<padding>value", records
 * separated by a blank line). Firebird has no clean batch/tab-separated mode
 * for `SELECT *`, so known column names are matched against each line's
 * prefix to split name from value.
 */
function parseListRows(stdout: string, columnNames: string[]): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    let current: Record<string, unknown> = {};

    for (const rawLine of stdout.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        if (line.trim() === "") {
            if (Object.keys(current).length > 0) {
                rows.push(current);
                current = {};
            }
            continue;
        }
        const name = columnNames.find((n) => line === n || (line.startsWith(n) && /^\s/.test(line[n.length] ?? "")));
        if (!name) continue;
        const rawValue = line.slice(name.length).replace(/^\s+/, "");
        current[name] = rawValue === "<null>" ? null : rawValue;
    }
    if (Object.keys(current).length > 0) rows.push(current);
    return rows;
}

export async function getTables(config: FirebirdConfig, database: string): Promise<TableInfo[]> {
    const stdout = await runQuery(config, database, TABLES_QUERY);
    return parseTablesOutput(stdout);
}

export async function getTableData(config: FirebirdConfig, options: TableDataOptions): Promise<TableDataResult> {
    const { database, table, page, pageSize, sortBy, sortDir, search, searchColumn, matchMode } = options;
    const offset = (page - 1) * pageSize;
    const tblId = `"${escapeFirebirdIdentifier(table)}"`;

    const whereClause = (search && searchColumn)
        ? matchMode === "equals"
            ? ` WHERE CAST("${escapeFirebirdIdentifier(searchColumn)}" AS VARCHAR(255)) = '${escapeFirebirdLiteral(search)}'`
            : matchMode === "starts"
            ? ` WHERE UPPER(CAST("${escapeFirebirdIdentifier(searchColumn)}" AS VARCHAR(255))) LIKE UPPER('${escapeFirebirdLiteral(search)}%')`
            : matchMode === "ends"
            ? ` WHERE UPPER(CAST("${escapeFirebirdIdentifier(searchColumn)}" AS VARCHAR(255))) LIKE UPPER('%${escapeFirebirdLiteral(search)}')`
            : ` WHERE UPPER(CAST("${escapeFirebirdIdentifier(searchColumn)}" AS VARCHAR(255))) LIKE UPPER('%${escapeFirebirdLiteral(search)}%')`
        : "";
    const sortClause = sortBy
        ? ` ORDER BY "${escapeFirebirdIdentifier(sortBy)}" ${sortDir === "desc" ? "DESC" : "ASC"}`
        : "";

    const countQuery = `${PREAMBLE}SELECT COUNT(*) FROM ${tblId}${whereClause};`;
    const dataQuery = `${PREAMBLE}SET LIST ON;\nSELECT * FROM ${tblId}${whereClause}${sortClause} ROWS ${offset + 1} TO ${offset + pageSize};`;
    const colQuery = columnsQuery(table);

    const [colOut, countOut, dataOut] = await Promise.all([
        runQuery(config, database, colQuery),
        runQuery(config, database, countQuery),
        runQuery(config, database, dataQuery),
    ]);

    const columns = parseColumnsOutput(colOut);
    const totalCount = parseInt(countOut.trim(), 10) || 0;
    const rows = parseListRows(dataOut, columns.map((c) => c.name));

    return { rows, totalCount, columns };
}
