import { query, type D1Connection } from "./api";
import { quoteIdentifier, userTablesSql } from "./sql";

/**
 * Values Cloudflare's export or import cannot carry, named before each backup.
 *
 * - **Integers beyond 2^53.** SQLite stores an integer with 64 bits, but the export of D1 writes
 *   every number through a JavaScript number, which holds an integer exactly only up to 2^53. A
 *   larger one lands in the dump rounded (9007199254740993 becomes 9007199254740992), and one near
 *   2^63 comes back from an import as a REAL.
 * - **Values too long for one statement.** The export writes each row as one INSERT, and the import
 *   takes no statement over 100 KB. A row with a text over about 100 KB or a BLOB over about 50 KB
 *   (it is written as hex) is in the backup, but a restore into D1 fails on it.
 *
 * The fault is Cloudflare's and DBackup takes their export as it is, so this check makes the run
 * log say what the backup will not give back. It reads every table once, which counts against the
 * rows read of the account, so a connection can turn it off.
 */

/** 2^53 - 1, the largest integer a JavaScript number holds exactly. */
const SAFE = "9007199254740991";

/** Bytes of a text in one INSERT that leave room for the rest of the statement below 100 KB. */
const LONG_TEXT = 95_000;

/** Bytes of a BLOB whose hex is that long. */
const LONG_BLOB = LONG_TEXT / 2;

type Log = (message: string, level?: "info" | "warning" | "error") => void;

/** One column with values the export or import cannot carry, and how many rows hold one. */
export interface RiskyColumn {
    table: string;
    column: string;
    largeIntegers: number;
    longValues: number;
}

/** Every column of every user table with an integer beyond ±(2^53 - 1) or a value too long for the import. */
export async function findRiskyValues(config: D1Connection, uuid: string): Promise<RiskyColumn[]> {
    const [tables] = await query<{ name: string }>(config, uuid, userTablesSql());
    const found: RiskyColumn[] = [];

    for (const { name: table } of tables?.results ?? []) {
        const [columns] = await query<{ name: string }>(config, uuid, "SELECT name FROM pragma_table_info(?)", [table]);
        const names = (columns?.results ?? []).map((column) => column.name);
        if (names.length === 0) continue;

        // One scan per table: two counts per column, by position, so no column name becomes an alias.
        const counts = names.flatMap((column, index) => {
            const col = quoteIdentifier(column);
            return [
                `SUM(typeof(${col}) = 'integer' AND (${col} > ${SAFE} OR ${col} < -${SAFE})) AS i${index}`,
                `SUM((typeof(${col}) = 'text' AND length(CAST(${col} AS BLOB)) > ${LONG_TEXT}) OR (typeof(${col}) = 'blob' AND length(${col}) > ${LONG_BLOB})) AS l${index}`,
            ];
        });
        const [result] = await query<Record<string, number | null>>(config, uuid, `SELECT ${counts.join(", ")} FROM ${quoteIdentifier(table)}`);
        const row = result?.results?.[0] ?? {};
        names.forEach((column, index) => {
            const largeIntegers = Number(row[`i${index}`] ?? 0);
            const longValues = Number(row[`l${index}`] ?? 0);
            if (largeIntegers > 0 || longValues > 0) found.push({ table, column, largeIntegers, longValues });
        });
    }
    return found;
}

const rowsOf = (count: number, what: string) => (count === 1 ? `1 ${what}` : `${count} ${what}s`);

/** Runs the check and writes what it found into the run log. Never fails the backup. */
export async function warnAboutRiskyValues(config: D1Connection, uuid: string, database: string, log: Log): Promise<void> {
    let found: RiskyColumn[];
    try {
        found = await findRiskyValues(config, uuid);
    } catch (error: unknown) {
        log(`Could not check the values of ${database}: ${error instanceof Error ? error.message : String(error)}`, "warning");
        return;
    }

    const integers = found.filter((entry) => entry.largeIntegers > 0);
    for (const { table, column, largeIntegers } of integers) {
        log(`${database}: table "${table}", column "${column}" holds ${rowsOf(largeIntegers, "integer")} beyond ±2^53.`, "warning");
    }
    if (integers.length > 0) {
        log(
            "The export of Cloudflare D1 rounds integers beyond ±2^53, so the backup holds these values rounded and a restore writes them back rounded. " +
            "This is a limit of Cloudflare's export, which DBackup cannot work around. Storing such values as TEXT keeps them exact.",
            "warning",
        );
    }

    const long = found.filter((entry) => entry.longValues > 0);
    for (const { table, column, longValues } of long) {
        log(`${database}: table "${table}", column "${column}" holds ${rowsOf(longValues, "value")} too long for the import of D1.`, "warning");
    }
    if (long.length > 0) {
        log(
            "The backup holds these rows, but D1 imports no statement over 100 KB and its export writes each row as one, so a restore into D1 fails on them. " +
            "A text over about 100 KB or a BLOB over about 50 KB is too long. The dump itself is complete and can be read by sqlite3.",
            "warning",
        );
    }
}
