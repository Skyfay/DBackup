import sql from "mssql";
import { MSSQLConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { buildConnectionConfig } from "./connection";

/** Sanitize a SQL Server identifier for bracket-quoting. */
function escapeMssqlIdentifier(name: string): string {
    return name.replace(/]/g, "]]").replace(/\0/g, "");
}

/** Sanitize a value for use in a SQL string literal (single-quoted). */
function escapeMssqlStringLiteral(name: string): string {
    return name.replace(/'/g, "''").replace(/\0/g, "");
}

export async function getTables(config: MSSQLConfig, database: string): Promise<TableInfo[]> {
    const dbId = escapeMssqlIdentifier(database);
    let pool: sql.ConnectionPool | null = null;

    try {
        const connCfg = buildConnectionConfig(config);
        pool = new sql.ConnectionPool(connCfg);
        await pool.connect();

        const result = await pool.request().query(`
            SELECT
                t.TABLE_SCHEMA AS schema_name,
                t.TABLE_NAME AS name,
                t.TABLE_TYPE AS table_type,
                COALESCE(SUM(p.rows), 0) AS row_count,
                COALESCE(SUM(CAST(a.total_pages AS BIGINT)) * 8 * 1024, 0) AS size_bytes
            FROM [${dbId}].INFORMATION_SCHEMA.TABLES t
            LEFT JOIN [${dbId}].sys.tables st ON st.name = t.TABLE_NAME AND st.schema_id = SCHEMA_ID(t.TABLE_SCHEMA)
            LEFT JOIN [${dbId}].sys.indexes i ON i.object_id = st.object_id AND i.type <= 1
            LEFT JOIN [${dbId}].sys.partitions p ON p.object_id = st.object_id AND p.index_id = i.index_id
            LEFT JOIN [${dbId}].sys.allocation_units a ON a.container_id = p.partition_id
            GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME, t.TABLE_TYPE
            ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
        `);

        return result.recordset.map(row => ({
            name: row.schema_name !== 'dbo' ? `${row.schema_name}.${row.name}` : row.name,
            type: (row.table_type === "VIEW" ? "view" : "table") as TableInfo["type"],
            rowCount: Number(row.row_count) || 0,
            sizeInBytes: Number(row.size_bytes) || 0,
        }));
    } finally {
        if (pool) await pool.close().catch(() => {});
    }
}

export async function getTableData(
    config: MSSQLConfig,
    options: TableDataOptions
): Promise<TableDataResult> {
    const { database, table, page, pageSize, sortBy, sortDir, search, searchColumn, matchMode } = options;
    const offset = (page - 1) * pageSize;
    const dbId = escapeMssqlIdentifier(database);
    // Table names from non-dbo schemas are stored as "schema.tableName"
    let tableSchema = "dbo";
    let tableName = table;
    if (table.includes(".")) {
        const dotIndex = table.indexOf(".");
        tableSchema = table.substring(0, dotIndex);
        tableName = table.substring(dotIndex + 1);
    }
    const schemaId = escapeMssqlIdentifier(tableSchema);
    const tblId = escapeMssqlIdentifier(tableName);
    const schemaLiteral = escapeMssqlStringLiteral(tableSchema);
    const tblLiteral = escapeMssqlStringLiteral(tableName);
    const sortColExpr = sortBy
        ? `[${escapeMssqlIdentifier(sortBy)}] ${sortDir === "desc" ? "DESC" : "ASC"}`
        : "(SELECT NULL)";
    const searchActive = !!(search && searchColumn);
    const searchTermValue = searchActive
        ? matchMode === "starts" ? `${search}%`
        : matchMode === "ends"   ? `%${search}`
        : matchMode === "equals" ? search!
        : `%${search}%`
        : undefined;
    const whereClause = searchActive
        ? matchMode === "equals"
            ? ` WHERE CAST([${escapeMssqlIdentifier(searchColumn!)}] AS NVARCHAR(MAX)) = @searchTerm`
            : ` WHERE CAST([${escapeMssqlIdentifier(searchColumn!)}] AS NVARCHAR(MAX)) LIKE @searchTerm`
        : "";
    let pool: sql.ConnectionPool | null = null;

    try {
        const connCfg = buildConnectionConfig(config);
        pool = new sql.ConnectionPool(connCfg);
        await pool.connect();

        const colReq = pool.request();
        const countReq = pool.request();
        const dataReq = pool.request();

        if (searchActive) {
            countReq.input("searchTerm", sql.NVarChar, searchTermValue);
            dataReq.input("searchTerm", sql.NVarChar, searchTermValue);
        }

        const [colResult, countResult, dataResult] = await Promise.all([
            colReq.query(`
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
                    CASE WHEN COLUMN_NAME IN (
                        SELECT kcu.COLUMN_NAME FROM [${dbId}].INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                        JOIN [${dbId}].INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                            ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_NAME = '${tblLiteral}'
                    ) THEN 'PRI' ELSE '' END AS COLUMN_KEY,
                    COLUMN_DEFAULT
                FROM [${dbId}].INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '${tblLiteral}' AND TABLE_SCHEMA = '${schemaLiteral}'
                ORDER BY ORDINAL_POSITION
            `),
            countReq.query(`SELECT COUNT(*) AS total FROM [${dbId}].[${schemaId}].[${tblId}]${whereClause}`),
            dataReq.query(`
                SELECT * FROM [${dbId}].[${schemaId}].[${tblId}]${whereClause}
                ORDER BY ${sortColExpr}
                OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
            `),
        ]);

        const columns: ColumnInfo[] = colResult.recordset.map(row => ({
            name: row.COLUMN_NAME,
            dataType: row.DATA_TYPE,
            nullable: row.IS_NULLABLE === "YES",
            primaryKey: row.COLUMN_KEY === "PRI",
            defaultValue: row.COLUMN_DEFAULT ?? undefined,
        }));

        const totalCount = Number(countResult.recordset[0]?.total) || 0;

        const rows: Record<string, unknown>[] = dataResult.recordset.map(row => {
            const record: Record<string, unknown> = {};
            for (const col of columns) {
                const val = row[col.name];
                record[col.name] = val === undefined ? null : val;
            }
            return record;
        });

        return { rows, totalCount, columns };
    } finally {
        if (pool) await pool.close().catch(() => {});
    }
}
