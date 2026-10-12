/**
 * What the lab knows about a database engine, in one file per engine under lab/src/engines. The
 * catalog, the dataset loader, the seed, `lab:status` and the tests read it from there, so a new
 * engine means a Compose service, an engine file and a dataset.
 */

import { randomUUID } from "crypto";
import type { LabConfig, SshLogin } from "../config";

/** The adapter ids of DBackup the lab runs in containers. SQLite has a file of its own and no container. */
export type Engine = "mysql" | "mariadb" | "postgres" | "mongodb" | "mssql" | "redis" | "valkey" | "firebird";

/** Runs a shell command where the database lives and returns what it printed. Throws when it fails. */
export type Run = (command: string, input?: string) => Promise<string>;

/** The command line tools of an engine where its database lives, logged in. */
export interface Clients {
    /** The interactive client: mysql, psql, mongosh, sqlcmd, redis-cli, isql. */
    cli: string;
    /** The dump tool, for the engines whose fingerprint is a dump. */
    dump?: string;
}

export interface EngineSpec {
    id: Engine;
    /** As the names of the connections show it, like "PostgreSQL". */
    name: string;
    /** One Compose service of lab/compose/databases.yml per version. */
    versions: { version: string; service: string; port: number; profile: "core" | "full" }[];
    /** The port the server listens on inside its container. */
    innerPort: number;
    login: { username: string; password: string };
    /** The clients inside the containers of the lab. */
    clients: Clients;
    /** The dataset under lab/datasets, and the shell commands that check for it and load it from standard input. */
    dataset: { file: string; check: string; load: string };
    /**
     * The config of a source of DBackup for a server reachable at host and port. `where` DBackup
     * runs: on this machine, like `pnpm dev`, or in the network of the lab, like the image in the
     * end-to-end tests.
     */
    source(target: { host: string; port: number }, lab: LabConfig, where?: "host" | "network"): Record<string, unknown>;
    /** Whether DBackup restores it by itself. Redis and Valkey restore by copying a file by hand. */
    restores: boolean;
    /** On a native server: the address its sources use there, and the clients as root. */
    native?: { host: string; clients: (login: SshLogin) => Clients };
    /** The database of the dataset the round trip restores, and where a copy of it goes. */
    database?: { name: string; location: string; restoreAs: (suffix: string) => { name: string; location: string } };
    /** What a database holds, read with the tools of the engine. Equal for a database and a faithful restore. */
    fingerprint?(run: Run, location: string, clients: Clients): Promise<string>;
    /** Removes a database again, and does nothing when it is not there. */
    drop?(run: Run, location: string, clients: Clients): Promise<void>;
}

/**
 * Runs a script through a client that reads a file, by way of a file in /tmp where the database
 * lives. The extension matters to the old mongo shell, which takes anything else for an address.
 */
export function viaFile(run: Run, client: (file: string) => string, script: string, extension = ".sql"): Promise<string> {
    const file = `/tmp/dbackup-lab-${randomUUID()}${extension}`;
    return run(`cat > ${file} && ${client(file)}; code=$?; rm -f ${file}; exit $code`, script);
}

/** A database restored under the name `shop_<suffix>`, which the tools find by that name. */
export const shopCopy = (suffix: string) => ({ name: `shop_${suffix}`, location: `shop_${suffix}` });
