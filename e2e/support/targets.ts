/**
 * What the end-to-end tests run against. A family is a Playwright project and a job of the CI
 * matrix: the databases it backs up, and the services of the lab it needs besides DBackup.
 * `E2E_FAMILIES=postgres,mysql` narrows a run to those families, `ui` names the browser tests.
 */

import { CUSTOMER, NOTIFY, STORAGE, databasesOf, type DatabaseService } from "../../lab/src/catalog";
import type { LabConfig, SshLogin } from "../../lab/src/config";
import { ENGINES, engineOf } from "../../lab/src/engines";
import { sqliteDatabase } from "../../lab/src/engines/sqlite";
import type { Engine } from "../../lab/src/engines/types";

/** A source of a test, as DBackup gets it and as the tools of its engine find it. */
export interface Target {
    /** The name of the test, like "postgres-12 over SSH". */
    key: string;
    adapterId: Engine | "sqlite";
    /** The config of the source, for DBackup in the network of the lab. */
    config: (lab: LabConfig) => Record<string, unknown>;
    /** The logins of the source: of the database, and of OpenSSH for one over SSH. */
    login?: { username: string; password: string };
    ssh?: { username: string; password: string };
    /** The service the database lives in, where its tools read it. */
    service: string;
    /** On the customer server the tools run as root with the clients of a native server. */
    native?: SshLogin;
    /** The database of the dataset and where a copy goes. Without one the backup is only checked, like for Redis. */
    database?: { name: string; location: string; restoreAs: (suffix: string) => { name: string; location: string } };
    /** A bug this found that is not fixed yet, in one sentence. The test then passes while it fails. */
    knownBug?: string;
}

export interface Family {
    name: string;
    targets: Target[];
    /** Services the tests of the family need besides those of the targets. */
    services?: string[];
}

const sshHost = { username: STORAGE.ssh.username, password: STORAGE.ssh.password };

/** A database container of the lab, reached by its service name. */
function container(database: DatabaseService, viaSsh = false): Target {
    const spec = engineOf(database.engine);
    return {
        key: viaSsh ? `${database.service} over SSH` : database.service,
        adapterId: spec.id,
        config: (lab) => ({
            ...spec.source({ host: database.service, port: spec.innerPort }, lab, "network"),
            ...(viaSsh ? { connectionMode: "ssh", sshHost: STORAGE.ssh.service, sshPort: 22 } : {}),
        }),
        login: spec.login,
        ssh: viaSsh ? sshHost : undefined,
        service: database.service,
        database: spec.database,
    };
}

const containers = (engines: Engine[], sshTwins: string[] = []): Target[] => {
    const databases = databasesOf("core").filter((database) => engines.includes(database.engine));
    return [...databases.map((database) => container(database)), ...databases.filter((database) => sshTwins.includes(database.service)).map((database) => container(database, true))];
};

const FIREBIRD_3 = "The gbak of Firebird 5, which the image ships, restores into a Firebird 3 server only over the service manager. Over a client connection it fails with a BLR syntax error.";

/** SQLite in the SSH host of the lab, over SSH. */
const sqliteOverSsh: Target = {
    key: "sqlite over SSH",
    adapterId: "sqlite",
    config: () => ({ mode: "ssh", path: `${STORAGE.ssh.home}/shop.db`, host: STORAGE.ssh.service, port: 22 }),
    ssh: sshHost,
    service: STORAGE.ssh.service,
    database: sqliteDatabase(`${STORAGE.ssh.home}/shop.db`),
};

/** The databases of the customer server, from the packages of Ubuntu, over its OpenSSH. */
function customerTargets(): Target[] {
    const login: SshLogin = { user: CUSTOMER.username, port: 22, password: CUSTOMER.password };
    const ssh = { username: CUSTOMER.username, password: CUSTOMER.password };
    const overSsh = { connectionMode: "ssh", sshHost: CUSTOMER.service, sshPort: 22 };
    const engines = ENGINES.filter((spec) => spec.native && spec.id !== "mongodb");
    return [
        ...engines.map((spec): Target => ({
            key: `customer ${spec.name}`,
            adapterId: spec.id,
            config: (lab) => ({ ...spec.source({ host: spec.native!.host, port: spec.innerPort }, lab, "network"), ...overSsh }),
            // Redis knows only its default user, with the password of the login.
            login: { username: spec.id === "redis" ? "default" : CUSTOMER.username, password: CUSTOMER.password },
            ssh,
            service: CUSTOMER.service,
            native: login,
            database: spec.database,
        })),
        {
            key: "customer SQLite",
            adapterId: "sqlite",
            config: () => ({ mode: "ssh", path: `/home/${CUSTOMER.username}/shop.db`, host: CUSTOMER.service, port: 22 }),
            ssh,
            service: CUSTOMER.service,
            database: sqliteDatabase(`/home/${CUSTOMER.username}/shop.db`),
        },
    ];
}

/** The storage servers and receivers the family storage writes to, in the network of the lab. */
export const STORAGE_SERVICES = [STORAGE.ssh.service, STORAGE.s3.service, STORAGE.webdav.service, STORAGE.samba.service, "ftp-e2e"];
export const NOTIFY_SERVICES = Object.values(NOTIFY).map((entry) => entry.service);

export const FAMILIES: Family[] = [
    { name: "postgres", targets: containers(["postgres"], ["postgres-12"]) },
    { name: "mysql", targets: containers(["mysql", "mariadb"], ["mysql-57", "mariadb-104"]) },
    { name: "mongodb", targets: containers(["mongodb"]) },
    { name: "mssql", targets: containers(["mssql"]) },
    {
        name: "small",
        targets: [
            ...containers(["redis", "valkey"], ["redis-6"]),
            ...containers(["firebird"]).map((target) => (target.service === "firebird-3" ? { ...target, knownBug: FIREBIRD_3 } : target)),
            sqliteOverSsh,
        ],
    },
    { name: "customer", targets: customerTargets() },
    // The destinations and channels, with SQLite inside DBackup as the source.
    { name: "storage", targets: [], services: [...STORAGE_SERVICES, ...NOTIFY_SERVICES] },
];

/** The services of the lab a family needs. */
export function servicesOf(family: Family): string[] {
    const fromTargets = family.targets.flatMap((target) => [target.service, ...(target.ssh && target.service !== CUSTOMER.service ? [STORAGE.ssh.service] : [])]);
    return [...new Set([...fromTargets, ...(family.services ?? [])])];
}

const wanted = () => process.env.E2E_FAMILIES?.split(",").map((name) => name.trim()).filter(Boolean);

/** The families of this run, from E2E_FAMILIES or all of them. */
export function selectedFamilies(): Family[] {
    const names = wanted();
    if (!names?.length) return FAMILIES;
    const unknown = names.filter((name) => name !== "ui" && !FAMILIES.some((family) => family.name === name));
    if (unknown.length) throw new Error(`E2E_FAMILIES names ${unknown.join(", ")}, the families are ui, ${FAMILIES.map((family) => family.name).join(", ")}`);
    return FAMILIES.filter((family) => names.includes(family.name));
}

/** Whether this run has the browser tests, which E2E_FAMILIES picks with `ui`. */
export function uiSelected(): boolean {
    const names = wanted();
    return !names?.length || names.includes("ui");
}

/** The UI tests back up one database, PostgreSQL 18, and read the mail of a shared channel in Mailpit. */
export const UI_SERVICES = ["postgres-18", NOTIFY.mailpit.service];
