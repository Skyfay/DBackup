/**
 * Quoting for the SQL DBackup sends with `mysql -e`. A database name of a restore target or the
 * user of a connection lands inside such a statement, so each is quoted for its place.
 * This is SQL quoting, never shell escaping, the argv stays as it is.
 */

/** A MySQL identifier (database, table, column) for use inside backticks. */
export function escapeMysqlIdentifier(name: string): string {
    return name.replace(/`/g, "``").replace(/\0/g, "");
}

/**
 * A MySQL string value for use inside a single-quoted literal. A quote is written as `''`, which
 * both modes read as one quote, where `\'` ends the literal under `NO_BACKSLASH_ESCAPES`. A
 * backslash is doubled, since without that mode `\` escapes the next character. Under the mode a
 * backslash of the value then reads as two, so such a value may not match, but it never leaves the
 * literal in either mode.
 */
export function escapeMysqlLiteral(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\0/g, "");
}
