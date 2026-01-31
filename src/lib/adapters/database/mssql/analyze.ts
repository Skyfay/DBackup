/**
 * Analyze a MSSQL .bak file to extract contained database names
 *
 * Note: Unlike SQL dumps, .bak files are binary and cannot be easily parsed.
 * This function uses RESTORE HEADERONLY to get metadata, but requires
 * the file to be accessible to a running SQL Server instance.
 *
 * For now, this returns an empty array since we can't analyze .bak files
 * without a SQL Server connection. The actual database name is typically
 * stored in the backup metadata.
 */
export async function analyzeDump(_sourcePath: string): Promise<string[]> {
    // MSSQL .bak files are binary and cannot be analyzed without a SQL Server instance
    // The caller should use RESTORE HEADERONLY or RESTORE FILELISTONLY via a connection
    // to get the actual database names from the backup file.

    // Return empty array - the restore process will use RESTORE FILELISTONLY
    // to determine the databases contained in the backup
    return [];
}
