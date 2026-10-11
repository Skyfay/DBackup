/**
 * Every service of the dev lab with its port and its test credentials. The Compose files under
 * lab/compose define the same services. `tests/unit/lab/catalog.test.ts` checks that both agree.
 */

export type Engine = "mysql" | "mariadb" | "postgres" | "mongodb" | "mssql" | "redis" | "valkey" | "firebird";

export interface DatabaseService {
    /** The Compose service, also its host name inside the lab network. */
    service: string;
    engine: Engine;
    /** The version as the connection name shows it. */
    version: string;
    port: number;
    profile: "core" | "full";
}

/** The port each engine listens on inside its container, for the SSH mode through the lab network. */
export const INNER_PORTS: Record<Engine, number> = {
    mysql: 3306, mariadb: 3306, postgres: 5432, mongodb: 27017, mssql: 1433, redis: 6379, valkey: 6379, firebird: 3050,
};

export const DATABASES: DatabaseService[] = [
    { service: "mysql-57", engine: "mysql", version: "5.7", port: 33357, profile: "core" },
    { service: "mysql-80", engine: "mysql", version: "8.0", port: 33380, profile: "full" },
    { service: "mysql-84", engine: "mysql", version: "8.4", port: 33384, profile: "full" },
    { service: "mysql-9", engine: "mysql", version: "9", port: 33390, profile: "core" },
    { service: "mariadb-104", engine: "mariadb", version: "10.4", port: 33304, profile: "core" },
    { service: "mariadb-1011", engine: "mariadb", version: "10.11", port: 33310, profile: "full" },
    { service: "mariadb-114", engine: "mariadb", version: "11.4", port: 33314, profile: "full" },
    { service: "mariadb-118", engine: "mariadb", version: "11.8", port: 33318, profile: "core" },
    { service: "postgres-12", engine: "postgres", version: "12", port: 54412, profile: "core" },
    { service: "postgres-13", engine: "postgres", version: "13", port: 54413, profile: "full" },
    { service: "postgres-14", engine: "postgres", version: "14", port: 54414, profile: "full" },
    { service: "postgres-15", engine: "postgres", version: "15", port: 54415, profile: "full" },
    { service: "postgres-16", engine: "postgres", version: "16", port: 54416, profile: "full" },
    { service: "postgres-17", engine: "postgres", version: "17", port: 54417, profile: "full" },
    { service: "postgres-18", engine: "postgres", version: "18", port: 54418, profile: "core" },
    { service: "mongo-44", engine: "mongodb", version: "4.4", port: 27704, profile: "core" },
    { service: "mongo-60", engine: "mongodb", version: "6.0", port: 27706, profile: "full" },
    { service: "mongo-70", engine: "mongodb", version: "7.0", port: 27707, profile: "full" },
    { service: "mongo-80", engine: "mongodb", version: "8.0", port: 27708, profile: "core" },
    { service: "mssql-2017", engine: "mssql", version: "2017", port: 14317, profile: "core" },
    { service: "mssql-2019", engine: "mssql", version: "2019", port: 14319, profile: "full" },
    { service: "mssql-2022", engine: "mssql", version: "2022", port: 14322, profile: "core" },
    { service: "redis-6", engine: "redis", version: "6", port: 63796, profile: "core" },
    { service: "redis-7", engine: "redis", version: "7", port: 63797, profile: "full" },
    { service: "redis-8", engine: "redis", version: "8", port: 63798, profile: "core" },
    { service: "valkey-72", engine: "valkey", version: "7.2", port: 63772, profile: "core" },
    { service: "valkey-8", engine: "valkey", version: "8", port: 63780, profile: "core" },
    { service: "firebird-3", engine: "firebird", version: "3", port: 31530, profile: "core" },
    { service: "firebird-4", engine: "firebird", version: "4", port: 31540, profile: "full" },
    { service: "firebird-5", engine: "firebird", version: "5", port: 31550, profile: "core" },
];

/** The login of each engine, the same for every version. */
export const DATABASE_LOGINS: Record<Engine, { username: string; password: string }> = {
    mysql: { username: "root", password: "rootpassword" },
    mariadb: { username: "root", password: "rootpassword" },
    postgres: { username: "testuser", password: "testpassword" },
    mongodb: { username: "root", password: "rootpassword" },
    mssql: { username: "sa", password: "YourStrong!Passw0rd" },
    redis: { username: "default", password: "testpassword" },
    valkey: { username: "default", password: "testpassword" },
    firebird: { username: "SYSDBA", password: "masterkey" },
};

/** Where SQL Server writes its .bak files, on the Docker host and in the container alike. */
export const MSSQL_BACKUP_DIR_REMOTE = "/srv/dbackup-lab/mssql";

/** The Firebird database every container creates, under the alias the sources use. */
export const FIREBIRD_DATABASE = { name: "shop", path: "/var/lib/firebird/data/shop.fdb" };

export const STORAGE = {
    ssh: { service: "ssh", port: 22220, username: "dbackup", password: "dbackup-password", home: "/home/dbackup" },
    s3: { service: "s3", port: 19000, accessKey: "lab", secretKey: "lab-password", bucket: "dbackup-lab" },
    webdav: { service: "webdav", port: 18080, username: "lab", password: "lab-password" },
    samba: { service: "samba", port: 445, share: "backups", username: "lab", password: "lab-password" },
    ftp: { service: "ftp", port: 2121, username: "lab", password: "lab-password", home: "/ftp/lab" },
} as const;

export const NOTIFY = {
    mailpit: { service: "mailpit", smtpPort: 1025, uiPort: 8025 },
    ntfy: { service: "ntfy", port: 18081 },
    gotify: { service: "gotify", port: 18082, username: "lab", password: "lab-password" },
    webhook: { service: "webhook", port: 18083 },
} as const;

export const ENGINE_NAMES: Record<Engine, string> = {
    mysql: "MySQL", mariadb: "MariaDB", postgres: "PostgreSQL", mongodb: "MongoDB", mssql: "SQL Server", redis: "Redis", valkey: "Valkey", firebird: "Firebird",
};

/** The name of the source of a database service, like "Lab PostgreSQL 18". */
export function sourceName(database: DatabaseService, suffix = ""): string {
    return `Lab ${ENGINE_NAMES[database.engine]} ${database.version}${suffix}`;
}

/** The services a profile starts. */
export function databasesOf(profile: "core" | "full"): DatabaseService[] {
    return profile === "full" ? DATABASES : DATABASES.filter((database) => database.profile === "core");
}
