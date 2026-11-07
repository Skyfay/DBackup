/**
 * Quoting for the SQL DBackup sends with `mysql -e`. A database name of a restore target or the
 * user of a connection lands inside such a statement, so each is quoted for its place.
 * This is SQL quoting, never shell escaping, the argv stays as it is.
 */

/** A MySQL identifier (database, table, column) for use inside backticks. */
export function escapeMysqlIdentifier(name: string): string {
    return name.replace(/`/g, "``").replace(/\0/g, "");
}

/** A MySQL string value for use inside a single-quoted literal. */
export function escapeMysqlLiteral(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\0/g, "");
}
