import { MSSQLDialect } from "./mssql-base";
import { MSSQL2017Dialect } from "./mssql-2017";

export interface MSSQLDatabaseDialect {
    /**
     * Generate T-SQL BACKUP DATABASE query
     */
    getBackupQuery(
        database: string,
        backupPath: string,
        options?: {
            compression?: boolean;
            stats?: number;
            copyOnly?: boolean;
        }
    ): string;

    /**
     * Generate T-SQL RESTORE DATABASE query
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
    ): string;

    /**
     * Check if this dialect supports the given version
     */
    supportsVersion(version: string): boolean;
}

/**
 * Get the appropriate dialect for the given SQL Server version
 */
export function getDialect(version?: string): MSSQLDatabaseDialect {
    if (version) {
        // Parse major version from "16.0.1000" format
        const majorVersion = parseInt(version.split(".")[0], 10);

        // SQL Server 2017 = version 14.x
        if (majorVersion <= 14) {
            return new MSSQL2017Dialect();
        }
    }

    // Default to modern dialect (2019+)
    return new MSSQLDialect();
}
