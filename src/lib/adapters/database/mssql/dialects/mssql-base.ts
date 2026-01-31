import { MSSQLDatabaseDialect } from "./index";

/**
 * Base MSSQL Dialect for SQL Server 2019+
 * Supports native backup compression and modern features
 */
export class MSSQLDialect implements MSSQLDatabaseDialect {
    /**
     * Generate T-SQL BACKUP DATABASE statement
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
        const opts = options || {};
        const withClauses: string[] = ["FORMAT", "INIT"];

        // Compression (available in Enterprise, or Standard with SQL Server 2008 R2+)
        if (opts.compression !== false) {
            withClauses.push("COMPRESSION");
        }

        // Progress reporting
        if (opts.stats) {
            withClauses.push(`STATS = ${opts.stats}`);
        }

        // Copy-only backup (doesn't affect backup chain)
        if (opts.copyOnly) {
            withClauses.push("COPY_ONLY");
        }

        // Add descriptive name
        withClauses.push(`NAME = N'${database}-Full Database Backup'`);

        return `BACKUP DATABASE [${database}] TO DISK = N'${backupPath}' WITH ${withClauses.join(", ")}`;
    }

    /**
     * Generate T-SQL RESTORE DATABASE statement
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
        const opts = options || {};
        const withClauses: string[] = [];

        // Replace existing database
        if (opts.replace) {
            withClauses.push("REPLACE");
        }

        // Recovery mode
        if (opts.recovery !== false) {
            withClauses.push("RECOVERY");
        } else {
            withClauses.push("NORECOVERY");
        }

        // Progress reporting
        if (opts.stats) {
            withClauses.push(`STATS = ${opts.stats}`);
        }

        // File relocation (for restoring to different database name)
        if (opts.moveFiles && opts.moveFiles.length > 0) {
            for (const file of opts.moveFiles) {
                withClauses.push(`MOVE N'${file.logicalName}' TO N'${file.physicalPath}'`);
            }
        }

        const withClause = withClauses.length > 0 ? ` WITH ${withClauses.join(", ")}` : "";
        return `RESTORE DATABASE [${database}] FROM DISK = N'${backupPath}'${withClause}`;
    }

    /**
     * Check version support
     */
    supportsVersion(version: string): boolean {
        const majorVersion = parseInt(version.split(".")[0], 10);
        return majorVersion >= 15; // SQL Server 2019+
    }
}
