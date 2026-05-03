/**
 * Database Backup File Extensions
 *
 * Maps adapter types to their appropriate file extensions.
 * This ensures backups are stored with meaningful extensions
 * that reflect the actual backup format.
 */

/**
 * Get the appropriate file extension for a database adapter type
 *
 * @param adapterId - The adapter identifier (e.g., 'mysql', 'redis', 'mongodb')
 * @returns The file extension without the leading dot (e.g., 'sql', 'rdb', 'archive')
 */
export function getBackupFileExtension(adapterId: string): string {
    const extensions: Record<string, string> = {
        // SQL text-based databases
        mysql: "sql",
        mariadb: "sql",

        // PostgreSQL uses custom binary format (more efficient than SQL text)
        postgres: "dump",

        // SQL Server native backup format
        mssql: "bak",

        // NoSQL and special formats
        mongodb: "archive",  // mongodump --archive format
        redis: "rdb",        // Redis RDB snapshot format
        sqlite: "db",        // SQLite database file copy
    };

    return extensions[adapterId.toLowerCase()] || "sql";
}

/**
 * Get a human-readable description of the backup format
 *
 * NOTE: Currently unused - kept for future UI integration (e.g. Storage Explorer, Backup Details).
 *
 * @param adapterId - The adapter identifier
 * @returns Description of the backup format
 */
export function getBackupFormatDescription(adapterId: string): string {
    const descriptions: Record<string, string> = {
        mysql: "MySQL SQL Dump",
        mariadb: "MariaDB SQL Dump",
        postgres: "PostgreSQL SQL Dump",
        mssql: "SQL Server Native Backup",
        mongodb: "MongoDB Archive",
        redis: "Redis RDB Snapshot",
        sqlite: "SQLite Database Copy",
    };

    return descriptions[adapterId.toLowerCase()] || "Database Backup";
}
