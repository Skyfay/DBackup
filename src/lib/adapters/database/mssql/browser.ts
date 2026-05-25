import sql from "mssql";
import { MSSQLConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import { buildConnectionConfig } from "./connection";

/** Sanitize a SQL Server identifier for bracket-quoting. */
function escapeMssqlIdentifier(name: string): string {
    return name.replace(/]/g, "]]").replace(/\0/g, "");
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
                t.TABLE_NAME AS name,
                t.TABLE_TYPE AS table_type,
                COALESCE(SUM(p.rows), 0) AS row_count,
                COALESCE(SUM(a.total_pages) * 8 * 1024, 0) AS size_bytes
            FROM [${dbId}].INFORMATION_SCHEMA.TABLES t
            LEFT JOIN [${dbId}].sys.tables st ON st.name = t.TABLE_NAME
            LEFT JOIN [${dbId}].sys.indexes i ON i.object_id = st.object_id AND i.type <= 1
            LEFT JOIN [${dbId}].sys.partitions p ON p.object_id = st.object_id AND p.index_id = i.index_id
            LEFT JOIN [${dbId}].sys.allocation_units a ON a.container_id = p.partition_id
            WHERE t.TABLE_SCHEMA = 'dbo'
            GROUP BY t.TABLE_NAME, t.TABLE_TYPE
            ORDER BY t.TABLE_NAME
        `);

        return result.recordset.map(row => ({
            name: row.name,
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
    const { database, table, page, pageSize } = options;
    const offset = (page - 1) * pageSize;
    const dbId = escapeMssqlIdentifier(database);
    const tblId = escapeMssqlIdentifier(table);
    let pool: sql.ConnectionPool | null = null;

    try {
        const connCfg = buildConnectionConfig(config);
        pool = new sql.ConnectionPool(connCfg);
        await pool.connect();

        const [colResult, countResult, dataResult] = await Promise.all([
            pool.request().query(`
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
                    CASE WHEN COLUMN_NAME IN (
                        SELECT kcu.COLUMN_NAME FROM [${dbId}].INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                        JOIN [${dbId}].INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                            ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_NAME = '${tblId}'
                    ) THEN 'PRI' ELSE '' END AS COLUMN_KEY,
                    COLUMN_DEFAULT
                FROM [${dbId}].INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '${tblId}' AND TABLE_SCHEMA = 'dbo'
                ORDER BY ORDINAL_POSITION
            `),
            pool.request().query(`SELECT COUNT(*) AS total FROM [${dbId}].[dbo].[${tblId}]`),
            pool.request().query(`
                SELECT * FROM [${dbId}].[dbo].[${tblId}]
                ORDER BY (SELECT NULL)
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
