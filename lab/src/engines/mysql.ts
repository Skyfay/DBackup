/** MySQL and MariaDB, which share their clients, the dataset and the fingerprint. */

import { shopCopy, type Clients, type EngineSpec, type Run } from "./types";

const login = { username: "root", password: "rootpassword" };
const auth = `-u${login.username} -p'${login.password}'`;

/** The MariaDB tools where the image has them, MySQL's own otherwise. */
const clients: Clients = {
    cli: `$(command -v mariadb || command -v mysql) --default-character-set=utf8mb4 ${auth}`,
    dump: `$(command -v mariadb-dump || command -v mysqldump) --default-character-set=utf8mb4 ${auth}`,
};

async function fingerprint(run: Run, database: string, tools: Clients): Promise<string> {
    const dump = await run(`${tools.dump} --skip-comments --skip-dump-date --routines --events --triggers ${database}`);
    // A restore makes its database with the default character set of the server, not the one of
    // the original, so SHOW CREATE TABLE names the character set of a column that differs from
    // it. The collation it names as well decides the character set.
    return dump.replace(/ CHARACTER SET \w+ COLLATE /g, " COLLATE ");
}

async function drop(run: Run, database: string, tools: Clients): Promise<void> {
    await run(`${tools.cli} -e "DROP DATABASE IF EXISTS ${database}"`);
}

const shared = {
    innerPort: 3306,
    login,
    clients,
    dataset: { file: "mysql.sql", check: `${clients.cli} -N -e "SHOW DATABASES LIKE 'inventory'"`, load: clients.cli },
    // The lab servers use certificates they signed themselves.
    source: (target: { host: string; port: number }) => ({ host: target.host, port: target.port, connectionMode: "direct", disableSsl: true }),
    restores: true,
    database: { name: "shop", location: "shop", restoreAs: shopCopy },
    fingerprint,
    drop,
} satisfies Partial<EngineSpec>;

export const MYSQL: EngineSpec = {
    ...shared,
    id: "mysql",
    name: "MySQL",
    versions: [
        { version: "5.7", service: "mysql-57", port: 33357, profile: "core" },
        { version: "8.0", service: "mysql-80", port: 33380, profile: "full" },
        { version: "8.4", service: "mysql-84", port: 33384, profile: "full" },
        { version: "9", service: "mysql-9", port: 33390, profile: "core" },
    ],
    // localhost makes the client take the socket, as root it needs no password there.
    native: { host: "localhost", clients: () => ({ cli: "mysql --default-character-set=utf8mb4", dump: "mysqldump --default-character-set=utf8mb4" }) },
};

export const MARIADB: EngineSpec = {
    ...shared,
    id: "mariadb",
    name: "MariaDB",
    versions: [
        { version: "10.4", service: "mariadb-104", port: 33304, profile: "core" },
        { version: "10.11", service: "mariadb-1011", port: 33310, profile: "full" },
        { version: "11.4", service: "mariadb-114", port: 33314, profile: "full" },
        { version: "11.8", service: "mariadb-118", port: 33318, profile: "core" },
    ],
};
