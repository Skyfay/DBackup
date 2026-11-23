import type { ExecutionHost } from "@/lib/transport";
import type { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import { AdapterError } from "@/lib/logging/errors";
import { MYSQL_CLIENT, buildConnectionArgs } from "./args";
import { queryClientArgs } from "./client-lock";
import { connectionClientOf, type DumpClient } from "./dump-content";
import { escapeMysqlIdentifier, escapeMysqlLiteral } from "./sql-quote";

/**
 * Stored procedures and functions of a MySQL server that MariaDB's dump tool cannot dump.
 *
 * mariadb-dump takes every server from version 10.3 on for MariaDB and then also asks it for
 * packages with `SHOW PACKAGE STATUS`, which MySQL does not know. MySQL counts its versions by the
 * year from 26 on, so the MariaDB tool fails on every MySQL 26 and later as soon as it dumps
 * routines. For such a server the dump runs without `--routines`, and DBackup reads the routines
 * itself and writes them after the dump, in the form mysqldump writes them, so a restore reads them
 * like any other dump.
 */

/** A routine as `SHOW CREATE FUNCTION` or `SHOW CREATE PROCEDURE` describes it. */
export interface RoutineDefinition {
    type: "FUNCTION" | "PROCEDURE";
    name: string;
    sqlMode: string;
    create: string;
    charsetClient: string;
    collationConnection: string;
}

/** How many routines one call of the client reads, so the statement stays short. */
const BATCH = 100;

/** The routines of the current database, functions first, as mysqldump writes them. */
const ROUTINE_LIST =
    "SELECT ROUTINE_TYPE, ROUTINE_NAME FROM information_schema.ROUTINES " +
    "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE IN ('FUNCTION', 'PROCEDURE') ORDER BY ROUTINE_TYPE, ROUTINE_NAME";

/**
 * Whether DBackup writes the routines of this server itself: the dump tool is MariaDB's and the
 * server is a MySQL of version 26 or later. The version DBackup keeps drops the `-MariaDB` suffix,
 * so a MariaDB 10 or 11 behind a connection of the type MySQL reads as one by its number alone.
 */
export function dumpsOwnRoutines(config: { type?: string; detectedVersion?: string }, client: DumpClient): boolean {
    const version = config.detectedVersion ?? "";
    if (!client.mariadb || config.type === "mariadb" || /mariadb/i.test(version)) return false;
    const major = Number(version.match(/^(\d+)\./)?.[1]);
    return major >= 26;
}

/** A value of the batch output of the client, where a tab, a line break, a NUL and a backslash come escaped. */
export function unescapeBatchValue(value: string): string {
    return value.replace(/\\([0tn\\])/g, (_, char: string) => ({ "0": "\0", t: "\t", n: "\n", "\\": "\\" })[char]!);
}

/** The rows of `SHOW CREATE FUNCTION` or `SHOW CREATE PROCEDURE` in batch output, in the order they were asked. */
export function parseShowCreate(stdout: string, asked: Array<{ type: RoutineDefinition["type"] }>): RoutineDefinition[] {
    const rows = stdout.split("\n").filter((line) => line.length > 0).map((line) => line.split("\t").map(unescapeBatchValue));
    if (rows.length !== asked.length) {
        throw new AdapterError("mysql", "dump", `Expected ${asked.length} routine definitions, the server sent ${rows.length}.`);
    }
    return rows.map(([name, sqlMode, create, charsetClient, collationConnection], i) => {
        if (create === undefined || create === "NULL") {
            throw new AdapterError("mysql", "dump", `The login may not read the definition of ${asked[i].type.toLowerCase()} ${name}.`);
        }
        return { type: asked[i].type, name, sqlMode, create, charsetClient, collationConnection };
    });
}

/** A character set or collation as a bare word, or nothing, since it goes into the dump unquoted. */
const word = (value: string) => (/^\w+$/.test(value) ? value : null);

/**
 * The routines as mysqldump writes them, each with the SQL mode and character set it was created
 * with. Plain statements rather than the `/*!50003 ... *\/` comments of mysqldump, which only
 * servers before 5.0.3 need, so a name of a routine never ends such a comment early.
 */
export function routinesSql(dbName: string, routines: RoutineDefinition[]): string {
    if (routines.length === 0) return "";
    const lines = ["", "--", `-- Dumping routines for database '${dbName.replace(/[\r\n]+/g, " ")}'`, "--"];
    for (const routine of routines) {
        const charset = word(routine.charsetClient);
        const collation = word(routine.collationConnection);
        lines.push(`DROP ${routine.type} IF EXISTS \`${escapeMysqlIdentifier(routine.name)}\`;`);
        if (charset && collation) {
            lines.push(
                "SET @saved_cs_client = @@character_set_client;",
                "SET @saved_cs_results = @@character_set_results;",
                "SET @saved_col_connection = @@collation_connection;",
                `SET character_set_client = ${charset};`,
                `SET character_set_results = ${charset};`,
                `SET collation_connection = ${collation};`,
            );
        }
        lines.push(
            "SET @saved_sql_mode = @@sql_mode;",
            `SET sql_mode = '${escapeMysqlLiteral(routine.sqlMode)}';`,
            "DELIMITER ;;",
            `${routine.create} ;;`,
            "DELIMITER ;",
            "SET sql_mode = @saved_sql_mode;",
        );
        if (charset && collation) {
            lines.push(
                "SET character_set_client = @saved_cs_client;",
                "SET character_set_results = @saved_cs_results;",
                "SET collation_connection = @saved_col_connection;",
            );
        }
    }
    return `${lines.join("\n")}\n`;
}

/**
 * Reads the stored procedures and functions of a database and returns them as SQL for the end of
 * its dump. The names of the routines go into the statements, so the client runs with its shell
 * commands off (`queryClientArgs`).
 *
 * @throws AdapterError when the client cannot read them, since a dump without them would look complete.
 */
export async function readRoutines(
    config: MySQLConfig | MariaDBConfig,
    dbName: string,
    host: ExecutionHost,
    authArgs: string[],
): Promise<{ sql: string; count: number }> {
    const mysqlBin = await host.which(...MYSQL_CLIENT);
    const client = await connectionClientOf(config, host, mysqlBin);
    const base = [mysqlBin, ...authArgs, ...await queryClientArgs(host, mysqlBin), ...buildConnectionArgs(config, host, { client })];
    // The database goes in as an argument of its own, so its name needs no quoting.
    const ask = async (sql: string) => {
        const result = await host.exec([...base, `--database=${dbName}`, "-N", "-s", "-e", sql]);
        if (result.code !== 0) {
            throw new AdapterError("mysql", "dump", `Reading the stored procedures and functions of ${dbName} failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
        }
        return result.stdout;
    };

    const listed = (await ask(ROUTINE_LIST)).split("\n").filter((line) => line.length > 0).map((line) => {
        const [type, name] = line.split("\t").map(unescapeBatchValue);
        return { type: type as RoutineDefinition["type"], name };
    });

    const routines: RoutineDefinition[] = [];
    for (let i = 0; i < listed.length; i += BATCH) {
        const batch = listed.slice(i, i + BATCH);
        const statements = batch.map((routine) => `SHOW CREATE ${routine.type} \`${escapeMysqlIdentifier(routine.name)}\``).join("; ");
        routines.push(...parseShowCreate(await ask(statements), batch));
    }
    return { sql: routinesSql(dbName, routines), count: routines.length };
}
