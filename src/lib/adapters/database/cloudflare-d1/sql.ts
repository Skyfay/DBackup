/**
 * SQL text this adapter builds itself. Values always go in as parameters, only identifiers are
 * written into the text, quoted.
 */

/** An identifier of SQLite in double quotes, a quote inside doubled. */
export function quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Objects of SQLite and of Cloudflare that are no data of the user. `sqlite_*` belongs to SQLite
 * (`sqlite_sequence` comes back with the dump), `_cf_*` to Cloudflare (`_cf_KV` exists in every D1
 * database and is never exported). `\` escapes the `_` of LIKE.
 */
export const INTERNAL_OBJECT_FILTER = "name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'";

/** The tables of the user, virtual tables left out, by name. */
export function userTablesSql(): string {
    return `SELECT name FROM sqlite_master WHERE type = 'table' AND ${INTERNAL_OBJECT_FILTER} AND sql NOT LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name`;
}
