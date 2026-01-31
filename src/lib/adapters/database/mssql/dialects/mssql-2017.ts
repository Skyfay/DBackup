import { MSSQLDialect } from "./mssql-base";

/**
 * MSSQL Dialect for SQL Server 2017 (v14.x)
 *
 * SQL Server 2017 has some differences:
 * - Backup compression available but with different default behavior
 * - Some newer T-SQL syntax not available
 */
export class MSSQL2017Dialect extends MSSQLDialect {
    /**
     * Generate T-SQL BACKUP DATABASE statement for SQL Server 2017
     *
     * Note: Compression is available but may not be enabled by default
     * in all editions. We still attempt to use it.
     */
    getBackupQuery(
        database: string,
        backupPath: string,
        options?: {
            compression?: boolean;
            stats?: number;
            copyOnly?: boolean;
        }
    ): string {
        // Use base implementation - SQL Server 2017 supports the same syntax
        return super.getBackupQuery(database, backupPath, options);
    }

    /**
     * Generate T-SQL RESTORE DATABASE statement for SQL Server 2017
     */
    getRestoreQuery(
        database: string,
        backupPath: string,
        options?: {
            replace?: boolean;
            recovery?: boolean;
            stats?: number;
            moveFiles?: { logicalName: string; physicalPath: string }[];
        }
    ): string {
        // Use base implementation - SQL Server 2017 supports the same syntax
        return super.getRestoreQuery(database, backupPath, options);
    }

    /**
     * Check version support - SQL Server 2017 is version 14.x
     */
    supportsVersion(version: string): boolean {
        const majorVersion = parseInt(version.split(".")[0], 10);
        return majorVersion === 14;
    }
}
