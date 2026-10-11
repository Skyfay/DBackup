/**
 * Loads the dataset of lab/datasets into each database container once, through the client inside
 * the container and its standard input. Nothing is mounted, so it works on a remote host too.
 */

import { readFileSync } from "fs";
import path from "path";
import { REPO_ROOT, type DockerHost } from "./config";
import { FIREBIRD_DATABASE, type DatabaseService, type Engine } from "./catalog";
import { isql, mongoShell, mysqlClient, psql, redisCli, sqlcmd } from "./clients";
import { composeArgs, run, runOrThrow } from "./docker";

interface Loader {
    file: string;
    /** A shell command that prints something only when the dataset is there already, from what it makes last. */
    check: string;
    /** A shell command that reads the dataset from its standard input. */
    load: string;
}

const firebird = isql(FIREBIRD_DATABASE.path);

const LOADERS: Record<Engine, Loader> = {
    mysql: {
        file: "mysql.sql",
        check: `${mysqlClient} -N -e "SHOW DATABASES LIKE 'inventory'"`,
        load: mysqlClient,
    },
    mariadb: {
        file: "mysql.sql",
        check: `${mysqlClient} -N -e "SHOW DATABASES LIKE 'inventory'"`,
        load: mysqlClient,
    },
    postgres: {
        file: "postgres.sql",
        check: `${psql} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'inventory'"`,
        load: `${psql} -d postgres -v ON_ERROR_STOP=1 -q`,
    },
    mongodb: {
        file: "mongodb.js",
        // An expression would print its value, null included, so the check prints only on a find.
        check: `${mongoShell} --eval "if (db.getMongo().getDBNames().indexOf('inventory') >= 0) print('yes')"`,
        load: mongoShell,
    },
    mssql: {
        file: "mssql.sql",
        check: `${sqlcmd} -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name = 'inventory'"`,
        // sqlcmd reads a file, not its standard input.
        load: `cat > /tmp/lab-dataset.sql && ${sqlcmd} -b -i /tmp/lab-dataset.sql`,
    },
    redis: {
        file: "redis.txt",
        check: `[ "$(${redisCli} EXISTS lab:dataset)" = "1" ] && echo yes || true`,
        load: redisCli,
    },
    valkey: {
        file: "redis.txt",
        check: `[ "$(${redisCli} EXISTS lab:dataset)" = "1" ] && echo yes || true`,
        load: redisCli,
    },
    firebird: {
        file: "firebird.sql",
        check: `echo "SELECT 'yes' FROM RDB\\$RELATIONS WHERE RDB\\$RELATION_NAME = 'ORDER_TOTALS';" | ${firebird} | grep -w yes || true`,
        load: firebird,
    },
};

/** Loads the dataset into one database service, unless it holds it already. Returns whether it loaded. */
export async function loadDataset(host: DockerHost, profile: "core" | "full", database: DatabaseService): Promise<boolean> {
    const loader = LOADERS[database.engine];
    const exec = (command: string) =>
        composeArgs(host, "databases", profile, ["exec", "-T", database.service, "sh", "-c", command]);

    const check = await run("docker", exec(loader.check));
    if (check.code === 0 && check.stdout.trim() !== "") return false;

    const dataset = readFileSync(path.join(REPO_ROOT, "lab", "datasets", loader.file), "utf8");
    await runOrThrow("docker", exec(loader.load), { input: dataset });
    return true;
}
