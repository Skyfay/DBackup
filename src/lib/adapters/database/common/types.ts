/**
 * Types for the Multi-DB TAR Archive Format (manifest v1)
 *
 * Multi-database backups are stored as TAR archives containing:
 * - manifest.json: Metadata about the archive and contained databases
 * - Individual dump files per database (format depends on adapter)
 *
 * Jobs with directory sources use the seekable v2 archive instead - its types live in
 * src/lib/archive/types.ts.
 */

/**
 * Database entry in a TAR manifest
 */
export interface DatabaseEntry {
    /** Original database name */
    name: string;
    /** Filename in the archive (e.g., "mydb.sql", "mydb.dump") */
    filename: string;
    /** Size in bytes (uncompressed) */
    size: number;
    /** Dump format: sql (MySQL), custom (PostgreSQL -Fc), archive (MongoDB), bak (MSSQL), fbk (Firebird gbak) */
    format: "sql" | "custom" | "archive" | "bak" | "fbk";
}

/**
 * Manifest stored as manifest.json in the TAR archive
 */
export interface TarManifest {
    /** Format version */
    version: 1;
    /** ISO 8601 timestamp when the archive was created */
    createdAt: string;
    /** Database type: mysql, mariadb, postgresql, mongodb, mssql */
    sourceType: string;
    /** Database engine version (e.g., "8.0.32", "15.2") */
    engineVersion?: string;
    /** List of databases in the archive */
    databases: DatabaseEntry[];
    /** Total size of all dumps in bytes (uncompressed) */
    totalSize: number;
}

/**
 * Result of extracting a TAR archive
 */
export interface ExtractResult {
    /** Parsed manifest from the archive */
    manifest: TarManifest;
    /** Absolute paths to extracted files */
    files: string[];
}

/**
 * Options for creating a TAR archive
 */
export interface CreateTarOptions {
    /** Database type (mysql, postgresql, etc.) */
    sourceType: string;
    /** Database engine version */
    engineVersion?: string;
    /** Unused by createMultiDbTar() - v1 archives are compressed as a whole in 03-upload.ts. */
    compression?: "NONE" | "GZIP" | "BROTLI";
}

/**
 * File entry for creating a TAR archive
 */
export interface TarFileEntry {
    /** Filename to use in the archive */
    name: string;
    /** Local path to the file */
    path: string;
    /** Database name this file represents */
    dbName: string;
    /** Format of the dump file */
    format: DatabaseEntry["format"];
}
