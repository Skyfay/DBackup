/**
 * What a customer reads of a restore of a shared database, engine by engine: lines like the ones
 * each database adapter and its tools write on success and failure, run through the scrubber with
 * a connection in the shape of that adapter's settings. The customer's database stays, the server,
 * its port, its login, its paths, the archive, the destination and the other databases go.
 */
import { describe, expect, it, vi } from "vitest";
import { sharedLogScrubber, versionShown } from "@/services/restore/shared-restore-log";

const facts = (connection: Record<string, unknown>) => sharedLogScrubber({
    keep: ["shop_acme"],
    archive: "backups/job1/2026-10-01_full.tar",
    destination: "Hetzner S3",
    connection,
    otherDatabases: ["shop_other", "billing"],
});

const cases: { engine: string; connection: Record<string, unknown>; lines: [string, string][] }[] = [
    {
        engine: "MySQL and MariaDB over SSH",
        connection: { host: "db7.msp.internal", port: 3306, user: "root", password: "S3cret!pw", connectionMode: "ssh", sshHost: "bastion.msp.example", sshPort: 22, sshUsername: "ops" },
        lines: [
            ["MySQL: ERROR 1045 (28000): Access denied for user 'dbackup'@'backup01.msp.internal' (using password: YES)", "MySQL: ERROR 1045 (28000): Access denied for user 'the user'@'an address' (using password: YES)"],
            ["MySQL: ERROR 2003 (HY000): Can't connect to MySQL server on 'db7.msp.internal:3306' (111)", "MySQL: ERROR 2003 (HY000): Can't connect to MySQL server on 'the server' (111)"],
            ["MySQL: ERROR 2005 (HY000): Unknown MySQL server host 'db8.msp.internal' (-2)", "MySQL: ERROR 2005 (HY000): Unknown MySQL server host 'the server' (-2)"],
            ["MySQL: ERROR 1146 (42S02) at line 42: Table 'billing.invoices' doesn't exist", "MySQL: ERROR 1146 (42S02) at line 42: Table 'another database.invoices' doesn't exist"],
            ["MySQL: ERROR 1449 (HY000) at line 99: The user specified as a definer ('admin'@'%') does not exist", "MySQL: ERROR 1449 (HY000) at line 99: The user specified as a definer ('the user'@'an address') does not exist"],
            ["SSH tunnel to bastion.msp.example:22 opened", "SSH tunnel to the server opened"],
            ["Restoring to database: shop_acme", "Restoring to database: shop_acme"],
        ],
    },
    {
        engine: "PostgreSQL",
        connection: { host: "pg-main", port: 5432, user: "postgres", password: "pgPass42" },
        lines: [
            ["pg_restore: error: connection to server at \"pg-main\" (10.0.0.8), port 5432 failed: FATAL:  password authentication failed for user \"postgres\"", "pg_restore: error: connection to server at \"the server\" (an address), its port failed: FATAL:  password authentication failed for user \"the user\""],
            ["pg_restore: error: could not execute query: ERROR:  cross-database references are not implemented: \"billing.public.invoices\"", "pg_restore: error: could not execute query: ERROR:  cross-database references are not implemented: \"another database.public.invoices\""],
            ["pg_restore: warning: errors ignored on restore: 1, host=pg-main port=5432 user=postgres dbname=shop_other", "pg_restore: warning: errors ignored on restore: 1, host=the server its port user=the user dbname=another database"],
        ],
    },
    {
        engine: "MongoDB",
        connection: { host: "mongo1.msp.internal", port: 27017, user: "mongoadmin", password: "m0ngoPw", authenticationDatabase: "admin" },
        lines: [
            ["[mongorestore] reading metadata for shop_acme.orders from archive '/tmp/restore-db-123-abc.archive'", "[mongorestore] reading metadata for shop_acme.orders from archive 'a path on the server'"],
            ["[mongorestore] restoring to existing collection shop_other.orders without dropping", "[mongorestore] restoring to existing collection another database.orders without dropping"],
            ["[mongorestore] Failed: (Unauthorized) not authorized on billing to execute command { listIndexes: \"x\" }", "[mongorestore] Failed: (Unauthorized) not authorized on another database to execute command { listIndexes: \"x\" }"],
        ],
    },
    {
        engine: "SQL Server",
        connection: { host: "sql01.msp.internal", port: 1433, user: "sa", password: "Mssql!pw", backupPath: "/var/opt/mssql/backup", sshPort: 2222 },
        lines: [
            ["Restoring from: /var/opt/mssql/backup/dbackup-restore-1b2c.bak", "Restoring from: a path on the server/dbackup-restore-1b2c.bak"],
            ["Restore failed for shop_acme: The file 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA\\shop.mdf' cannot be overwritten.  It is being used by database 'billing'.", "Restore failed for shop_acme: The file 'a path on the server' cannot be overwritten.  It is being used by database 'another database'."],
            ["Failed to prepare shop_acme: Cannot prepare restore for 'shop_acme': Login failed for user 'sa'.", "Failed to prepare shop_acme: Cannot prepare restore for 'shop_acme': Login failed for user 'the user'."],
            ["Failed to connect to sql01.msp.internal:1433 - getaddrinfo ENOTFOUND sql01.msp.internal (SSH tunnel: connect ECONNREFUSED 192.168.10.4:2222)", "Failed to connect to the server - getaddrinfo ENOTFOUND the server (SSH tunnel: connect ECONNREFUSED an address)"],
        ],
    },
    {
        engine: "Azure SQL",
        connection: { host: "acme-sql.database.windows.net", port: 1433, user: "sqladmin", password: "Az!pw" },
        lines: [
            ["SqlPackage: Importing to database 'shop_acme' on server 'tcp:acme-sql.database.windows.net,1433'.", "SqlPackage: Importing to database 'shop_acme' on server 'tcp:the server'."],
            ["Login failed for user 'sqladmin'.", "Login failed for user 'the user'."],
        ],
    },
    {
        engine: "Firebird",
        connection: { host: "db7", port: 3051, user: "SYSDBA", password: "Fb!pw", databases: [{ name: "shop_acme", path: "/firebird/data/shop.fdb" }, { name: "billing", path: "employee.fdb" }] },
        lines: [
            ["gbak: ERROR:I/O error during \"open O_CREAT\" operation for file \"/firebird/data/shop.fdb\"", "gbak: ERROR:I/O error during \"open O_CREAT\" operation for file \"a path on the server\""],
            ["gbak: ERROR:I/O error during \"open\" operation for file \"employee.fdb\"", "gbak: ERROR:I/O error during \"open\" operation for file \"a path on the server\""],
            ["gbak: ERROR:Unable to complete network request to host \"db7\".", "gbak: ERROR:Unable to complete network request to host \"the server\"."],
        ],
    },
    {
        engine: "SQLite over SSH",
        connection: { mode: "ssh", path: "/srv/apps/acme/shop_acme.db", host: "files01.msp.internal", port: 22, username: "deploy", password: "Sq!pw", sqliteBinaryPath: "/usr/local/bin/sqlite3" },
        lines: [
            ["Starting SQLite restore of /srv/apps/acme/shop_acme.db...", "Starting SQLite restore of a path on the server..."],
            ["ssh: connect to host files01.msp.internal port 22: Connection refused", "ssh: connect to host the server its port: Connection refused"],
            ["deploy@files01.msp.internal: Permission denied (publickey,password).", "the user@the server: Permission denied (publickey,password)."],
        ],
    },
    {
        engine: "Redis and Valkey with a Sentinel",
        connection: { mode: "sentinel", host: "2001:db8::17", port: 6379, username: "redisops", password: "R3dis!pw", sentinelMasterName: "mymaster", sentinelNodes: "sentinel1:26379,sentinel2.msp.internal:26379" },
        lines: [
            ["Cannot connect to Redis/Valkey: Could not connect to Redis at [2001:db8::17]:6379: Connection refused", "Cannot connect to Redis/Valkey: Could not connect to Redis at [the server]: Connection refused"],
            ["Could not connect to Redis at sentinel1:26379: Name or service not known", "Could not connect to Redis at the server: Name or service not known"],
            ["-ERR No such master with that name mymaster", "-ERR No such master with that name the server"],
        ],
    },
];

describe("the restore log a customer reads, engine by engine", () => {
    for (const { engine, connection, lines } of cases) {
        it(`hides the server, its login, paths and other databases of ${engine}, and keeps the customer's database`, () => {
            const scrubber = facts(connection);
            for (const [line, shown] of lines) expect(scrubber.text(line)).toBe(shown);
        });
    }

    it("never shows a password, whatever line names it", () => {
        const scrubber = facts({ host: "db7.msp.internal", password: "S3cret!pw" });
        expect(scrubber.text("mysql: using password S3cret!pw for shop_acme")).not.toContain("S3cret!pw");
    });
});

describe("what a customer reads of the server, beyond its plain host and port", () => {
    it("hides the name of a MongoDB replica set, from a connection string and from a host list", () => {
        const fromUri = facts({ uri: "mongodb://backup:pw@mongo1.msp:27017,mongo2.msp:27017/?replicaSet=msp-rs0&authSource=admin" });
        expect(fromUri.text("[mongorestore] connected to replica set msp-rs0")).toBe("[mongorestore] connected to replica set the server");
        const fromHost = facts({ host: "rs0/mongo1.msp:27017,mongo2.msp:27018", user: "backup" });
        expect(fromHost.text("No primary in replica set rs0, tried mongo2.msp:27018")).toBe("No primary in replica set the server, tried the server");
    });

    it("hides every host of a host list, each with its port", () => {
        const scrubber = facts({ host: "pg1.msp.example:5432,pg2.other.example:5433" });
        expect(scrubber.text("could not connect to pg2.other.example:5433 or pg1.msp.example")).toBe("could not connect to the server or the server");
        expect(scrubber.text("standby on port 5433")).toBe("standby on its port");
    });

    it("keeps the data folder of SQL Server for the provider's run alone", () => {
        const log = vi.fn();
        const wrapped = facts({ host: "sql01.msp.internal" }).wrap(log);
        wrapped("Placing database files in: /var/opt/mssql/data");
        wrapped("Restore completed for: shop_acme");
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("Restore completed for: shop_acme", undefined, undefined);
    });

    it("hides another database at the start of a longer name, like its log file", () => {
        const scrubber = facts({ host: "sql01.msp.internal" });
        expect(scrubber.text("The logical file 'billing_log' and billing-data are in use, shop_acme_log is not"))
            .toBe("The logical file 'another database_log' and another database-data are in use, shop_acme_log is not");
    });

    it("hides a port given as a flag, after Firebird's host, and any port after a hidden address", () => {
        const mysql = facts({ host: "db7.msp.internal", port: 3306 });
        expect(mysql.text("mysql exited: -P 3306 and -P3306")).toBe("mysql exited: -P its port and -P its port");
        expect(mysql.text("connect ECONNREFUSED 10.0.0.8:43125 via db7.msp.internal:43126")).toBe("connect ECONNREFUSED an address via the server");
        const firebird = facts({ host: "db7", port: 3051, databases: [{ name: "shop_acme", path: "/firebird/data/shop.fdb" }] });
        expect(firebird.text("gbak: ERROR:Unable to complete network request to host \"db7/3051:/firebird/data/shop.fdb\"."))
            .toBe("gbak: ERROR:Unable to complete network request to host \"the server:a path on the server\".");
    });

    it("hides a host of one label with the domain a line puts after it", () => {
        const scrubber = facts({ host: "db7", port: 3051 });
        expect(scrubber.text("Unable to resolve db7.msp.internal, retrying db7")).toBe("Unable to resolve the server, retrying the server");
    });

    it("hides the first label of an Azure SQL server, which logins and errors name alone", () => {
        const scrubber = facts({ host: "acme-sql.database.windows.net", port: 1433, user: "sqladmin" });
        expect(scrubber.text("Login failed for user 'sqladmin@acme-sql'.")).toBe("Login failed for user 'the user@the server'.");
        expect(scrubber.text("Cannot open server 'acme-sql' requested by the login.")).toBe("Cannot open server 'the server' requested by the login.");
    });

    it("keeps the version of the engine without the build and the system it runs on", () => {
        const scrubber = facts({ host: "db7.msp.internal" });
        expect(scrubber.text("Target server version: 8.0.36-0ubuntu0.22.04.1")).toBe("Target server version: 8.0.36");
        expect(scrubber.text("Target server version: 10.11.6-MariaDB-0+deb12u1.")).toBe("Target server version: 10.11.6.");
        expect(scrubber.text("Server: 16.2 (Debian 16.2-1.pgdg120+2)")).toBe("Server: 16.2");
        expect(scrubber.text("PostgreSQL 16.1 on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit")).toBe("PostgreSQL 16.1");
        expect(scrubber.text("Firebird LI-V5.0.1.1469 Firebird 5.0")).toBe("Firebird 5.0.1.1469");
        expect(scrubber.text("Server: Microsoft SQL Server 2022 (RTM-CU12) (KB5033663) - 16.0.4135.4 (X64) \n\tJan 18 2024 12:32:11 \n\tCopyright (C) 2022 Microsoft Corporation\n\tDeveloper Edition (64-bit) on Linux (Ubuntu 22.04.4 LTS) <X64>"))
            .toBe("Server: 16.0.4135.4");
        // A time with its zone and a size stay as they are.
        expect(scrubber.text("2026-10-16T12:30:45.123+0000 read 1.5-2 MB")).toBe("2026-10-16T12:30:45.123+0000 read 1.5-2 MB");
    });

    it("names a version by its number alone where the run keeps it apart from the log", () => {
        expect(versionShown("8.0.36-0ubuntu0.22.04.1")).toBe("8.0.36");
        expect(versionShown("Microsoft SQL Server 2022 (RTM-CU12) (KB5033663) - 16.0.4135.4 (X64)")).toBe("16.0.4135.4");
        expect(versionShown("LI-V5.0.1.1469")).toBe("5.0.1.1469");
        expect(versionShown("16")).toBe("16");
        expect(versionShown(null)).toBeNull();
    });
});
