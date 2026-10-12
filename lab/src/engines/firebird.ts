/**
 * Firebird 3 to 5. Each container creates one database file, which the sources know under an
 * alias, and a restore writes a new file next to it.
 */

import path from "path";
import { viaFile, type Clients, type EngineSpec, type Run } from "./types";

/** The database every container creates, under the alias the sources use. */
export const FIREBIRD_DATABASE = { name: "shop", path: "/var/lib/firebird/data/shop.fdb" };

const login = { username: "SYSDBA", password: "masterkey" };

/** isql takes the database as its last argument. */
const clients: Clients = { cli: `isql -user ${login.username} -password ${login.password} -ch UTF8` };

/** The metadata of a database, then every row of its tables and the value of each generator. */
async function fingerprint(run: Run, file: string, tools: Clients): Promise<string> {
    const isql = `${tools.cli} ${file}`;
    const objects = await viaFile(run, (script) => `${isql} -i ${script}`, `
SET HEADING OFF;
SELECT 'T', TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL
UNION ALL
SELECT 'G', TRIM(RDB$GENERATOR_NAME) FROM RDB$GENERATORS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
ORDER BY 1, 2;
`);
    const queries = objects.split("\n").map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 2).map(([kind, object]) =>
        kind === "T" ? `SELECT * FROM "${object}" ORDER BY 1;` : `SELECT GEN_ID("${object}", 0) FROM RDB$DATABASE;`);
    const rows = await viaFile(run, (script) => `${isql} -i ${script}`, `SET BLOB ALL;\n${queries.join("\n")}\n`);
    const metadata = await run(isql.replace(/^isql /, "isql -x "));
    return `${metadata}\n${rows}`;
}

const folder = path.posix.dirname(FIREBIRD_DATABASE.path);

export const FIREBIRD: EngineSpec = {
    id: "firebird",
    name: "Firebird",
    versions: [
        { version: "3", service: "firebird-3", port: 31530, profile: "core" },
        { version: "4", service: "firebird-4", port: 31540, profile: "full" },
        { version: "5", service: "firebird-5", port: 31550, profile: "core" },
    ],
    innerPort: 3050,
    login,
    clients,
    dataset: {
        file: "firebird.sql",
        check: `echo "SELECT 'yes' FROM RDB\\$RELATIONS WHERE RDB\\$RELATION_NAME = 'ORDER_TOTALS';" | ${clients.cli} ${FIREBIRD_DATABASE.path} | grep -w yes || true`,
        load: `${clients.cli} ${FIREBIRD_DATABASE.path}`,
    },
    source: (target) => ({ host: target.host, port: target.port, connectionMode: "direct", databases: [FIREBIRD_DATABASE] }),
    restores: true,
    // The target of a Firebird restore is the path of the new file on the server.
    database: {
        name: FIREBIRD_DATABASE.name,
        location: FIREBIRD_DATABASE.path,
        restoreAs: (suffix) => ({ name: `${folder}/shop_${suffix}.fdb`, location: `${folder}/shop_${suffix}.fdb` }),
    },
    fingerprint,
    drop: async (run: Run, file: string) => {
        await run(`rm -f ${file}`);
    },
};
