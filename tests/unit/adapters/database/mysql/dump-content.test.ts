import { describe, it, expect, vi } from "vitest";
import { createFakeHost } from "@/lib/testing/fake-host";
import { clientFromVersion, dumpClientOf, readableContent } from "@/lib/adapters/database/mysql/dump-content";
import type { MySQLConfig } from "@/lib/adapters/definitions";

const config = { host: "db.internal", port: 3306, user: "backup", database: "shop" } as unknown as MySQLConfig;

/** A host whose mysql client answers SHOW EVENTS and the routine question as given. */
function askingHost(answers: { events?: { code: number; stderr?: string }; hidden?: string[] }) {
    return createFakeHost({
        onExec: (argv) => {
            const sql = argv.at(-1) ?? "";
            if (sql === "SHOW EVENTS") return { code: answers.events?.code ?? 0, stderr: answers.events?.stderr ?? "" };
            if (sql.includes("information_schema.ROUTINES")) return { stdout: (answers.hidden ?? []).join("\n") };
            return undefined;
        },
    });
}

describe("the dump tool that runs", () => {
    it("tells MySQL's own mysqldump from MariaDB's by its version line", () => {
        expect(clientFromVersion("mysqldump  Ver 8.0.46 for Linux on aarch64 (MySQL Community Server - GPL)")).toEqual({ setsGtidPurged: true });
        expect(clientFromVersion("mysqldump  Ver 10.13 Distrib 5.7.44, for Linux (x86_64)")).toEqual({ setsGtidPurged: true });
        expect(clientFromVersion("mysqldump  Ver 8.0.36-28 for Linux on x86_64 (Percona Server (GPL), Release 28)")).toEqual({ setsGtidPurged: true });
        expect(clientFromVersion("mariadb-dump  Ver 10.19 Distrib 10.11.18-MariaDB, for debian-linux-gnu (aarch64)")).toEqual({ setsGtidPurged: false });
        expect(clientFromVersion("mariadb-dump from 11.4.10-MariaDB, client 10.19 for debian-linux-gnu (aarch64)")).toEqual({ setsGtidPurged: false });
    });

    it("counts a mysqldump older than 5.6.9 or one that does not answer as one without --set-gtid-purged", () => {
        expect(clientFromVersion("mysqldump  Ver 10.13 Distrib 5.5.62, for Linux (x86_64)")).toEqual({ setsGtidPurged: false });
        expect(clientFromVersion("")).toEqual({ setsGtidPurged: false });
    });

    it("is asked once per host and binary", async () => {
        const host = createFakeHost({ onExec: () => ({ stdout: "mysqldump  Ver 8.0.46 for Linux" }) });

        await dumpClientOf(host, "mysqldump");
        expect(await dumpClientOf(host, "mysqldump")).toEqual({ setsGtidPurged: true });
        expect(host.calls.exec).toEqual([["mysqldump", "--version"]]);
    });
});

describe("what the login may read", () => {
    it("leaves out the events with a warning when the login lacks the EVENT privilege", async () => {
        const host = askingHost({ events: { code: 1, stderr: "ERROR 1044 (42000) at line 1: Access denied for user 'backup'@'%' to database 'shop'" } });
        const onLog = vi.fn();

        expect(await readableContent(config, "shop", host, ["--defaults-file=/tmp/x.cnf"], onLog)).toEqual({ events: false });
        expect(onLog).toHaveBeenCalledWith(expect.stringContaining("Events of shop left out"), "warning");
        expect(onLog.mock.calls[0][0]).toContain("Grant it EVENT");
    });

    it("keeps the events when the question fails for another reason, which the dump then reports", async () => {
        const host = askingHost({ events: { code: 1, stderr: "ERROR 2013 (HY000): Lost connection to server during query" } });

        expect(await readableContent(config, "shop", host, [], vi.fn())).toEqual({});
    });

    it("leaves out the routines and names the ones the login cannot read", async () => {
        const onLog = vi.fn();
        const result = await readableContent(config, "shop", askingHost({ hidden: ["function f_add", "procedure p_hello"] }), [], onLog);

        expect(result).toEqual({ routines: false });
        expect(onLog.mock.calls[0][0]).toContain("Stored procedures and functions of shop left out: the login may not read function f_add, procedure p_hello");
        expect(onLog.mock.calls[0][0]).toContain("SHOW_ROUTINE");
    });

    it("asks with the database as an argument of its own and the login of the source", async () => {
        const host = askingHost({});
        await readableContent(config, "it's `odd`", host, ["--defaults-file=/tmp/x.cnf"], vi.fn());

        expect(host.calls.exec[0]).toEqual(expect.arrayContaining(["--defaults-file=/tmp/x.cnf", "--database=it's `odd`", "SHOW EVENTS"]));
    });

    it("asks nothing for parts that are switched off or left to the extra options", async () => {
        const host = askingHost({});

        await readableContent({ ...config, routines: false, events: false }, "shop", host, [], vi.fn());
        await readableContent({ ...config, options: "--skip-events -R" }, "shop", host, [], vi.fn());

        expect(host.calls.exec).toEqual([]);
    });

    it("keeps everything when there is no mysql client to ask", async () => {
        const host = createFakeHost({ onWhich: (candidates) => (candidates.includes("mariadb") ? null : undefined) });

        expect(await readableContent(config, "shop", host, [], vi.fn())).toEqual({});
    });
});
