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
        // SQL-based databases use .sql
        mysql: "sql",
        mariadb: "sql",
        postgres: "sql",
        mssql: "bak",

        // NoSQL and special formats
        mongodb: "archive",  // mongodump --archive format
        redis: "rdb",        // Redis RDB snapshot format
        valkey: "rdb",       // Valkey RDB snapshot format (same as Redis)
        sqlite: "db",        // SQLite database file copy
        firebird: "fbk",     // Firebird gbak native backup format
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
        valkey: "Valkey RDB Snapshot",
        sqlite: "SQLite Database Copy",
        firebird: "Firebird gbak Backup",
    };

    return descriptions[adapterId.toLowerCase()] || "Database Backup";
}
