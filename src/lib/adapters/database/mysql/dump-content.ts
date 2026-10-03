import type { ExecutionHost } from "@/lib/transport";
import type { LogLevel, LogType } from "@/lib/core/logs";
import type { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import { compareVersions } from "@/lib/utils";
import { MYSQL_CLIENT, buildConnectionArgs } from "./args";

/**
 * What a MySQL or MariaDB dump holds besides tables, views and triggers, which the dump tools
 * include on their own: one consistent snapshot per database, stored procedures and functions,
 * and events. Each is a switch of the source that is on unless it says false, so a source saved
 * before the switches existed gets them too.
 *
 * These flags go before the extra options of the source, so a `--skip-routines` there still wins.
 * An option the extra options already set in any form is not added a second time.
 */

type ContentConfig = Pick<MySQLConfig | MariaDBConfig, "options"> & {
    singleTransaction?: boolean;
    routines?: boolean;
    events?: boolean;
};

type OnLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

/** The extra options of a source, one argument each, as the dump tool gets them. */
export function optionTokens(options: string | undefined): string[] {
    return (options ?? "").split(" ").filter((token) => token.trim().length > 0);
}

/**
 * Whether the extra options set an option in any form, like `--routines`, `--skip-routines`,
 * `--routines=0` or `-R`. The tools read `_` and `-` in a name alike.
 */
function mentions(tokens: string[], name: string, short?: string): boolean {
    const pattern = new RegExp(`^--(?:loose-)?(?:skip-|disable-|enable-)?${name}(?:=.*)?$`);
    return tokens.some((token) => pattern.test(token.replace(/_/g, "-")) || (short !== undefined && token === `-${short}`));
}

/**
 * Whether the extra options lock the tables. The tools silently drop `--lock-tables` next to a
 * snapshot and refuse `--lock-all-tables` with one, so either leaves the snapshot out.
 */
function locksTables(tokens: string[]): boolean {
    return tokens.some((token) => {
        if (token === "-l" || token === "-x") return true;
        const match = token.replace(/_/g, "-").match(/^--(?:loose-)?(?:enable-)?lock-(?:all-)?tables(?:=(.*))?$/);
        return match !== null && !/^(0|off|false)$/i.test(match[1] ?? "");
    });
}

export interface DumpContent {
    /** One consistent snapshot per database, `--single-transaction`, instead of locking its tables. */
    singleTransaction: boolean;
    routines: boolean;
    events: boolean;
}

/** What DBackup asks the dump tool for itself: switched on in the source and not left to its extra options. */
export function plannedContent(config: ContentConfig): DumpContent {
    const tokens = optionTokens(config.options);
    return {
        singleTransaction: config.singleTransaction !== false && !mentions(tokens, "single-transaction") && !locksTables(tokens),
        routines: config.routines !== false && !mentions(tokens, "routines", "R"),
        events: config.events !== false && !mentions(tokens, "events", "E"),
    };
}

/** The dump tool that runs. MariaDB's and MySQL's own know different flags. */
export interface DumpClient {
    /** MySQL's own mysqldump from 5.6.9 on, which knows `--set-gtid-purged`. MariaDB's refuses it. */
    setsGtidPurged: boolean;
}

/** The flags for what the dump holds, which go before the extra options. */
export function contentArgs(config: ContentConfig, client?: DumpClient): string[] {
    const content = plannedContent(config);
    const args: string[] = [];
    if (content.singleTransaction) args.push("--single-transaction");
    if (content.routines) args.push("--routines");
    if (content.events) args.push("--events");
    // On a server with GTIDs, MySQL's mysqldump flushes the tables for the GTID set of a snapshot,
    // which needs RELOAD, and writes that set into the dump, which a restore onto another server
    // refuses. Off changes nothing on a server without GTIDs.
    if (client?.setsGtidPurged && !mentions(optionTokens(config.options), "set-gtid-purged")) {
        args.push("--set-gtid-purged=OFF");
    }
    return args;
}

/** "mysqldump  Ver 8.0.46 for Linux" is MySQL's own, "Distrib 10.11.18-MariaDB" is MariaDB's. */
export function clientFromVersion(output: string): DumpClient {
    if (!output.trim() || /mariadb/i.test(output)) return { setsGtidPurged: false };
    const version = output.match(/Distrib (\d+\.\d+\.\d+)/)?.[1] ?? output.match(/Ver (\d+\.\d+\.\d+)/)?.[1];
    return { setsGtidPurged: version !== undefined && compareVersions(version, "5.6.9") >= 0 };
}

const clients = new WeakMap<ExecutionHost, Map<string, Promise<DumpClient>>>();

/** What the dump binary on this host is, asked once per host and binary. A tool that does not answer counts as MariaDB's. */
export function dumpClientOf(host: ExecutionHost, binary: string): Promise<DumpClient> {
    let known = clients.get(host);
    if (!known) {
        known = new Map();
        clients.set(host, known);
    }
    let client = known.get(binary);
    if (!client) {
        client = host.exec([binary, "--version"]).then(
            (result) => clientFromVersion(result.code === 0 ? result.stdout : ""),
            () => ({ setsGtidPurged: false }),
        );
        known.set(binary, client);
    }
    return client;
}

/** The routines of the current database whose body the login may not read, which make the dump tool give up. */
const HIDDEN_ROUTINES =
    "SELECT CONCAT(LOWER(ROUTINE_TYPE), ' ', ROUTINE_NAME) FROM information_schema.ROUTINES " +
    "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_DEFINITION IS NULL";

/**
 * Leaves out what the login may not read instead of letting the dump fail: events without the
 * EVENT privilege, which the dump tools refuse even for a database without any, and routines
 * whose body the login cannot see. Each part left out is a warning that says what to grant.
 *
 * A login with SELECT on the database alone sees no routines of other users at all. The dump
 * leaves them out without an error, and nothing here can tell, so the guide names the grant.
 *
 * When the check itself cannot run, the flags stay and the dump tool reports what it finds.
 */
export async function readableContent(
    config: MySQLConfig | MariaDBConfig,
    dbName: string,
    host: ExecutionHost,
    authArgs: string[],
    onLog: OnLog,
): Promise<Partial<DumpContent>> {
    const planned = plannedContent(config);
    if (!planned.routines && !planned.events) return {};

    const overrides: Partial<DumpContent> = {};
    try {
        const mysqlBin = await host.which(...MYSQL_CLIENT);
        // The database goes in as an argument of its own, so its name needs no quoting.
        const ask = (sql: string) =>
            host.exec([mysqlBin, ...authArgs, ...buildConnectionArgs(config, host), `--database=${dbName}`, "-N", "-s", "-e", sql]);

        if (planned.events) {
            const events = await ask("SHOW EVENTS");
            // 1044 is the missing EVENT privilege. Anything else, like a lost connection, the dump reports itself.
            if (events.code !== 0 && /\b1044\b|access denied/i.test(events.stderr)) {
                overrides.events = false;
                onLog(
                    `Events of ${dbName} left out: the login may not read them. Grant it EVENT on the database, or turn off Events in the source.`,
                    "warning",
                );
            }
        }

        if (planned.routines) {
            const hidden = await ask(HIDDEN_ROUTINES);
            const names = hidden.code === 0 ? hidden.stdout.split("\n").map((line) => line.trim()).filter(Boolean) : [];
            if (names.length > 0) {
                overrides.routines = false;
                onLog(
                    `Stored procedures and functions of ${dbName} left out: the login may not read ${names.join(", ")}. ` +
                    "Grant it SHOW_ROUTINE on MySQL 8.0.20 and later or SELECT on mysql.proc on older servers, or turn off Stored procedures and functions in the source.",
                    "warning",
                );
            }
        }
    } catch {
        // No mysql client next to the dump tool. The dump runs with the flags as planned.
    }
    return overrides;
}
