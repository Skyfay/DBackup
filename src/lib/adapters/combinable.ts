/**
 * Database adapters a job may combine with directory sources.
 *
 * Every database adapter can write a seekable archive, but combining is a restore question
 * as much as a backup one: the restore page hands Redis and Valkey to their manual wizard,
 * which has no way to put files back. Client-safe, the job form reads the same list the
 * job service enforces.
 */
export const COMBINABLE_WITH_DIRECTORIES: readonly string[] = [
    "mysql",
    "mariadb",
    "postgres",
    "mongodb",
    "firebird",
    "mssql",
    "azure-sql",
    "sqlite",
];

export function isCombinableWithDirectories(adapterId: string): boolean {
    return COMBINABLE_WITH_DIRECTORIES.includes(adapterId);
}
