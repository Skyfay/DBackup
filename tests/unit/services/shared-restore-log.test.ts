/**
 * The run log of a restore a customer started on a shared server names their database and nothing
 * else of the server: what the database adapters log passes through the scrubber on its way there.
 */
import { describe, expect, it, vi } from "vitest";
import { sharedLogScrubber } from "@/services/restore/shared-restore-log";

const CONNECTION = { host: "db7.msp.internal", port: 3306, user: "dbackup", password: "s3cret-pw", database: ["shop_acme", "shop_globex"] };

const scrubber = (extra: Partial<Parameters<typeof sharedLogScrubber>[0]> = {}) => sharedLogScrubber({
    keep: ["shop_acme"],
    archive: "Shared MySQL/2026-10-15_0214_Shared_MySQL_nightly.tar",
    destination: "MSP NAS",
    connection: CONNECTION,
    otherDatabases: ["shop_acme", "shop_globex", "wiki_initech"],
    ...extra,
});

describe("the log of a customer's restore on a shared server", () => {
    it("keeps the line of a command and drops the command itself, which names the server and its login", () => {
        const log = vi.fn();
        scrubber().wrap(log)("Restoring to database: shop_acme", "info", "command", "mysql -h db7.msp.internal -P 3306 -u dbackup shop_acme");
        expect(log).toHaveBeenCalledWith("Restoring to database: shop_acme", "info", "command");
    });

    it("names the server, its port and its login in neutral words in an error of the server's tools", () => {
        const { text } = sharedLogScrubber({ keep: ["shop_acme"], connection: { host: "pg.msp.internal", port: 5432, user: "dbackup" } });
        expect(text('pg_restore: error: connection to server at "pg.msp.internal" (10.20.0.5), port 5432 failed: FATAL: password authentication failed for user "dbackup"'))
            .toBe('pg_restore: error: connection to server at "the server" (an address), its port failed: FATAL: password authentication failed for user "the user"');
        expect(scrubber().text("MySQL: ERROR 2003 (HY000): Can't connect to MySQL server on 'db7.msp.internal:3306' (111)"))
            .toBe("MySQL: ERROR 2003 (HY000): Can't connect to MySQL server on 'the server' (111)");
    });

    it("never names the archive, another archive of its chain, the destination or a path on the server", () => {
        const { text } = scrubber();
        expect(text("Archives missing: Shared MySQL/2026-10-15_0214_Shared_MySQL_nightly.tar, 2026-10-14_0214_Shared_MySQL_nightly.tar"))
            .toBe("Archives missing: the backup, a backup");
        expect(text("Could not read MSP NAS")).toBe("Could not read the storage");
        expect(text("Backup file staged at: /var/opt/mssql/backup/dbackup_restore_42.bak (local: /mnt/share/dbackup_restore_42.bak)"))
            .toBe("Backup file staged at: a path on the server (local: a path on the server)");
        expect(text("Cannot open backup device 'C:\\Program Files\\Microsoft SQL Server\\MSSQL\\Backup\\x.bak'. Operating system error 2"))
            .toBe("Cannot open backup device 'a path on the server'. Operating system error 2");
    });

    it("hides the other databases of the backup and the server, never the customer's own or one every server has", () => {
        const { text } = scrubber();
        expect(text("Restored shop_acme after shop_globex and wiki_initech")).toBe("Restored shop_acme after another database and another database");
        expect(text("mysql exited with code 1")).toBe("mysql exited with code 1");
    });

    it("keeps the customer's database when the login or another name of the server is called the same or is a part of it", () => {
        const { text } = sharedLogScrubber({ keep: ["shop.acme"], connection: { user: "shop.acme", host: "db" }, otherDatabases: ["acme"] });
        expect(text("Access denied for user 'shop.acme' to database 'shop.acme'")).toBe("Access denied for user 'shop.acme' to database 'shop.acme'");
        expect(text("Database acme is not shop.acme")).toBe("Database another database is not shop.acme");
    });

    it("never reads a neutral word as a value again", () => {
        const { text } = sharedLogScrubber({ keep: ["shop_acme"], connection: { host: "db7.msp.internal", user: "server" } });
        expect(text("Access denied for user 'server'@'db7.msp.internal'")).toBe("Access denied for user 'the user'@'the server'");
    });

    it("hides any other host of the domain of the server, like a replica or a node of its cluster", () => {
        const { text } = scrubber();
        expect(text("Lost the connection to replica2.msp.internal, retrying on DB8.MSP.INTERNAL and msp.internal"))
            .toBe("Lost the connection to the server, retrying on the server and the server");
        // A host of another domain, a name with a dot of the customer and a version stay as they are.
        expect(text("Fetched from mirror.example.org into shop_acme.orders on 8.0.36")).toBe("Fetched from mirror.example.org into shop_acme.orders on 8.0.36");
    });

    it("hides nothing more than the host itself when its domain has a single label", () => {
        const { text } = sharedLogScrubber({ keep: ["shop_acme"], connection: { host: "mongo1.msp" } });
        expect(text("mongo1.msp is down, mongo2.msp took over")).toBe("the server is down, mongo2.msp took over");
    });

    it("hides the name of the master of a Sentinel, which names the server too", () => {
        const { text } = sharedLogScrubber({ keep: ["0"], connection: { sentinelNodes: "10.0.0.5:26379", sentinelMasterName: "msp-redis-main" } });
        expect(text("Sentinel has no master named msp-redis-main")).toBe("Sentinel has no master named the server");
    });

    it("hides a password that a tool wrote out", () => {
        expect(scrubber().text("Using password s3cret-pw")).toBe("Using password a secret");
    });

    it("hides the hosts and the login of a connection string", () => {
        const { text } = sharedLogScrubber({ keep: ["shop_acme"], connection: { uri: "mongodb://backup:pw@mongo1.msp:27017,mongo2.msp:27017/?authSource=admin" } });
        expect(text("[mongorestore] connection refused to mongo2.msp:27017 as backup")).toBe("[mongorestore] connection refused to the server as the user");
    });

    it("leaves out the settings of the server and the kernel log of its host", () => {
        const log = vi.fn();
        const wrapped = scrubber().wrap(log);
        wrapped("Server settings: max_allowed_packet=67108864 innodb_buffer_pool_size=134217728");
        wrapped("OOM killer detected: [8812.1] Killed process 4412 (mysqld) total-vm:9912kB", "error");
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("The server ran out of memory during the restore.", "error", undefined);
    });

    it("leaves plain progress lines, times and versions as they are", () => {
        const { text } = scrubber();
        for (const line of ["Target server version: 16.0.4135.4", "2026-10-16T12:30:45.123+0000 finished restoring shop_acme.orders (12 documents, 0 failures)", "1.2 MB / 3 MB - 1 MB/s"]) {
            expect(text(line)).toBe(line);
        }
    });
});
