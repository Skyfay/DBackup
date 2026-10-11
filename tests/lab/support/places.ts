/**
 * Reads a database of the lab from outside of DBackup, with the tools of the engine where the
 * database lives: in its container, on a native host over ssh, or on this machine. The content
 * of the original and of a restore must read the same.
 */

import { randomUUID } from "crypto";
import type { Host } from "../../../lab/src/config";
import { isql, mongoShell, mysqlClient, mysqlDump, pgDump, psql, sqlcmd } from "../../../lab/src/clients";
import { run } from "../../../lab/src/docker";
import { execIn } from "../../../lab/src/environment";
import { sshArgs } from "../../../lab/src/provision";
import { config, type SourceEngine } from "./lab";

export type Place =
    | { kind: "service"; group: "databases" | "storage"; service: string }
    | { kind: "host"; host: Host }
    | { kind: "local" };

const describePlace = (place: Place) =>
    place.kind === "service" ? place.service : place.kind === "host" ? place.host.name : "this machine";

/** Runs a shell command where the database lives and returns its output. Throws on failure, with `what` it was. */
export async function runAt(place: Place, what: string, command: string, input?: string): Promise<string> {
    const result = place.kind === "service"
        ? await execIn(config, place.group, place.service, command, input)
        : place.kind === "host"
            ? await run("ssh", sshArgs(place.host, command), { input })
            : await run("sh", ["-c", command], { input });
    if (result.code !== 0) {
        throw new Error(`${what} on ${describePlace(place)} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout;
}

/**
 * Runs a script through a client that reads a file, by way of a file in /tmp of that place. The
 * extension matters to the old mongo shell, which takes anything else for a server address.
 */
async function runScript(place: Place, what: string, client: (file: string) => string, script: string, extension = ".sql"): Promise<string> {
    const file = `/tmp/dbackup-lab-${randomUUID()}${extension}`;
    return runAt(place, what, `cat > ${file} && ${client(file)}; code=$?; rm -f ${file}; exit $code`, script);
}

interface Clients {
    mysql: string;
    mysqlDump: string;
    psql: string;
    pgDump: string;
    mongo: string;
}

/** The containers log in with the logins of the catalog, a native host as root over its sockets. */
function clientsAt(place: Place): Clients {
    if (place.kind !== "host") return { mysql: mysqlClient, mysqlDump, psql, pgDump, mongo: mongoShell };
    const login = place.host.native!.ssh;
    return {
        mysql: "mysql --default-character-set=utf8mb4",
        mysqlDump: "mysqldump --default-character-set=utf8mb4",
        psql: "runuser -u postgres -- psql",
        pgDump: "runuser -u postgres -- pg_dump",
        mongo: `mongosh --quiet -u ${login.user} -p '${login.password}' --authenticationDatabase admin`,
    };
}

const mongoFingerprint = (name: string) => `
const d = db.getSiblingDB(${JSON.stringify(name)});
const infos = d.getCollectionInfos().map(function (i) { return { name: i.name, type: i.type, options: i.options }; });
infos.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
const hashes = d.runCommand({ dbHash: 1 }).collections;
const collections = infos.filter(function (i) { return i.type === "collection"; }).map(function (i) {
    const c = d.getCollection(i.name);
    const indexes = c.getIndexes().map(function (x) { return { key: x.key, name: x.name, unique: !!x.unique }; });
    return { name: i.name, documents: c.countDocuments({}), md5: hashes[i.name], indexes: indexes };
});
print(JSON.stringify({ views: infos.filter(function (i) { return i.type === "view"; }), collections: collections }, null, 1));
`;

/** Row counts and checksums of every table, then every object and the code of each module. */
const mssqlFingerprint = (name: string) => `
SET NOCOUNT ON;
USE [${name}];
DECLARE @sql nvarchar(max);
SELECT @sql = STRING_AGG(CAST(N'SELECT ''' + s.name + N'.' + t.name + N''' AS name, COUNT_BIG(*) AS n, CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS c FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) AS nvarchar(max)), N' UNION ALL ')
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id;
SET @sql = N'SELECT * FROM (' + @sql + N') AS tables ORDER BY name';
EXEC sp_executesql @sql;
SELECT o.type, o.name FROM sys.objects o WHERE o.is_ms_shipped = 0 ORDER BY o.type, o.name;
SELECT OBJECT_NAME(m.object_id), m.definition FROM sys.sql_modules m ORDER BY 1;
GO
`;

const mssqlDrop = (name: string) => `
IF DB_ID('${name}') IS NOT NULL
BEGIN
    ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${name}];
END
GO
`;

/** The metadata of a Firebird database, then every row of its tables and the value of each generator. */
async function firebirdFingerprint(place: Place, file: string): Promise<string> {
    const client = isql(file);
    const objects = await runScript(place, "Listing the tables", (script) => `${client} -i ${script}`, `
SET HEADING OFF;
SELECT 'T', TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL
UNION ALL
SELECT 'G', TRIM(RDB$GENERATOR_NAME) FROM RDB$GENERATORS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
ORDER BY 1, 2;
`);
    const queries = objects.split("\n").map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 2).map(([kind, object]) =>
        kind === "T" ? `SELECT * FROM "${object}" ORDER BY 1;` : `SELECT GEN_ID("${object}", 0) FROM RDB$DATABASE;`);
    const rows = await runScript(place, "Reading the tables", (script) => `${client} -i ${script}`, `SET BLOB ALL;\n${queries.join("\n")}\n`);
    const metadata = await runAt(place, "Extracting the metadata", client.replace(/^isql /, "isql -x "));
    return `${metadata}\n${rows}`;
}

/** What the database holds, as the tools of its engine read it. Equal for a database and a faithful restore of it. */
export async function fingerprint(engine: SourceEngine, place: Place, database: string): Promise<string> {
    const clients = clientsAt(place);
    const what = `Reading ${database}`;
    switch (engine) {
        case "mysql":
        case "mariadb": {
            const dump = await runAt(place, what, `${clients.mysqlDump} --skip-comments --skip-dump-date --routines --events --triggers ${database}`);
            // A restore makes its database with the default character set of the server, not the
            // one of the original, so SHOW CREATE TABLE names the character set of a column that
            // differs from it. The collation it names as well decides the character set.
            return dump.replace(/ CHARACTER SET \w+ COLLATE /g, " COLLATE ");
        }
        case "postgres": {
            const dump = await runAt(place, what, `${clients.pgDump} --no-comments --no-owner --no-privileges ${database}`);
            // pg_dump of newer minor versions guards its script with a random key per dump.
            return dump.split("\n").filter((line) => !/^\\(un)?restrict /.test(line)).join("\n");
        }
        case "mongodb":
            return runScript(place, what, (file) => `${clients.mongo} ${file}`, mongoFingerprint(database), ".js");
        case "mssql":
            return runScript(place, what, (file) => `${sqlcmd} -b -h -1 -W -i ${file}`, mssqlFingerprint(database));
        case "firebird":
            return firebirdFingerprint(place, database);
        case "sqlite":
            return runAt(place, what, `sqlite3 ${database} .dump`);
        default:
            throw new Error(`No fingerprint for ${engine}`);
    }
}

/** Removes a restored database again. Does nothing when it is not there. */
export async function drop(engine: SourceEngine, place: Place, database: string): Promise<void> {
    const clients = clientsAt(place);
    const what = `Dropping ${database}`;
    switch (engine) {
        case "mysql":
        case "mariadb":
            await runAt(place, what, `${clients.mysql} -e "DROP DATABASE IF EXISTS ${database}"`);
            return;
        case "postgres":
            await runAt(place, what, `${clients.psql} -d postgres -c "DROP DATABASE IF EXISTS ${database}"`);
            return;
        case "mongodb":
            await runScript(place, what, (file) => `${clients.mongo} ${file}`, `db.getSiblingDB(${JSON.stringify(database)}).dropDatabase();\n`, ".js");
            return;
        case "mssql":
            await runScript(place, what, (file) => `${sqlcmd} -b -i ${file}`, mssqlDrop(database));
            return;
        case "firebird":
        case "sqlite":
            await runAt(place, what, `rm -f ${database}`);
            return;
        default:
            throw new Error(`No way to drop a database of ${engine}`);
    }
}
