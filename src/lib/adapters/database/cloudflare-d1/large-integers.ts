import { query, type D1Connection } from "./api";
import { quoteIdentifier, userTablesSql } from "./sql";

/**
 * Integers the export of Cloudflare cannot write exactly.
 *
 * SQLite stores an integer with 64 bits, but the export of D1 writes every number through a
 * JavaScript number, which holds an integer exactly only up to 2^53. A larger one lands in the dump
 * rounded (9007199254740993 becomes 9007199254740992), and one near 2^63 comes back from an import
 * as a REAL. The fault is Cloudflare's and DBackup takes their export as it is, so before each export
 * this check names every column that holds such a value, which makes the run log say what the
 * backup will not keep. It reads every table once, which counts against the rows read of the
 * account, so a connection can turn it off.
 */

/** 2^53 - 1, the largest integer a JavaScript number holds exactly. */
const SAFE = "9007199254740991";

type Log = (message: string, level?: "info" | "warning" | "error") => void;

/** One column with integers beyond the safe range, and how many rows hold one. */
export interface LargeIntegerColumn {
    table: string;
    column: string;
    rows: number;
}

/** Every column of every user table that holds an integer beyond ±(2^53 - 1). */
export async function findLargeIntegers(config: D1Connection, uuid: string): Promise<LargeIntegerColumn[]> {
    const [tables] = await query<{ name: string }>(config, uuid, userTablesSql());
    const found: LargeIntegerColumn[] = [];

    for (const { name: table } of tables?.results ?? []) {
        const [columns] = await query<{ name: string }>(config, uuid, "SELECT name FROM pragma_table_info(?)", [table]);
        const names = (columns?.results ?? []).map((column) => column.name);
        if (names.length === 0) continue;

        // One scan per table: a count per column, by position, so no column name becomes an alias.
        const counts = names.map((column, index) => {
            const col = quoteIdentifier(column);
            return `SUM(typeof(${col}) = 'integer' AND (${col} > ${SAFE} OR ${col} < -${SAFE})) AS c${index}`;
        });
        const [result] = await query<Record<string, number | null>>(config, uuid, `SELECT ${counts.join(", ")} FROM ${quoteIdentifier(table)}`);
        const row = result?.results?.[0] ?? {};
        names.forEach((column, index) => {
            const rows = Number(row[`c${index}`] ?? 0);
            if (rows > 0) found.push({ table, column, rows });
        });
    }
    return found;
}

/** Runs the check and writes what it found into the run log. Never fails the backup. */
export async function warnAboutLargeIntegers(config: D1Connection, uuid: string, database: string, log: Log): Promise<void> {
    let found: LargeIntegerColumn[];
    try {
        found = await findLargeIntegers(config, uuid);
    } catch (error: unknown) {
        log(`Could not check ${database} for integers the export rounds: ${error instanceof Error ? error.message : String(error)}`, "warning");
        return;
    }
    if (found.length === 0) return;

    for (const { table, column, rows } of found) {
        log(`${database}: table "${table}", column "${column}" holds ${rows === 1 ? "1 integer" : `${rows} integers`} beyond ±2^53.`, "warning");
    }
    log(
        "The export of Cloudflare D1 rounds integers beyond ±2^53, so the backup holds these values rounded and a restore writes them back rounded. " +
        "This is a limit of Cloudflare's export, which DBackup cannot work around. Storing such values as TEXT keeps them exact.",
        "warning",
    );
}
