/** PostgreSQL, from 12 to 18. */

import { shopCopy, type Clients, type EngineSpec, type Run } from "./types";

const login = { username: "testuser", password: "testpassword" };

/** The containers trust local connections, so the clients need no password. */
const clients: Clients = { cli: `psql -U ${login.username}`, dump: `pg_dump -U ${login.username}` };

async function fingerprint(run: Run, database: string, tools: Clients): Promise<string> {
    const dump = await run(`${tools.dump} --no-comments --no-owner --no-privileges ${database}`);
    // pg_dump of newer minor versions guards its script with a random key per dump.
    return dump.split("\n").filter((line) => !/^\\(un)?restrict /.test(line)).join("\n");
}

async function drop(run: Run, database: string, tools: Clients): Promise<void> {
    await run(`${tools.cli} -d postgres -c "DROP DATABASE IF EXISTS ${database}"`);
}

export const POSTGRES: EngineSpec = {
    id: "postgres",
    name: "PostgreSQL",
    versions: [
        { version: "12", service: "postgres-12", port: 54412, profile: "core" },
        { version: "13", service: "postgres-13", port: 54413, profile: "full" },
        { version: "14", service: "postgres-14", port: 54414, profile: "full" },
        { version: "15", service: "postgres-15", port: 54415, profile: "full" },
        { version: "16", service: "postgres-16", port: 54416, profile: "full" },
        { version: "17", service: "postgres-17", port: 54417, profile: "full" },
        { version: "18", service: "postgres-18", port: 54418, profile: "core" },
    ],
    innerPort: 5432,
    login,
    clients,
    dataset: {
        file: "postgres.sql",
        check: `${clients.cli} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'inventory'"`,
        load: `${clients.cli} -d postgres -v ON_ERROR_STOP=1 -q`,
    },
    source: (target) => ({ host: target.host, port: target.port, connectionMode: "direct" }),
    restores: true,
    native: { host: "127.0.0.1", clients: () => ({ cli: "runuser -u postgres -- psql", dump: "runuser -u postgres -- pg_dump" }) },
    database: { name: "shop", location: "shop", restoreAs: shopCopy },
    fingerprint,
    drop,
};
