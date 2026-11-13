import { describe, it, expect } from "vitest";

import { createFakeHost } from "@/lib/testing/fake-host";
import { getTables, getTableData } from "@/lib/adapters/database/mysql/browser";
import { ensureDatabase } from "@/lib/adapters/database/mysql/connection";
import { NO_LOCAL_INFILE } from "@/lib/adapters/database/mysql/args";
import { STATEMENT_CHARSET, queryClientArgs } from "@/lib/adapters/database/mysql/client-lock";
import type { HostKind } from "@/lib/transport/types";
import { MARIADB_HELP, MYSQL_HELP, clientHelp, clientHost, statements } from "./mysql/client-help";

/**
 * A table, column or database name of a request lands in a statement the mysql or mariadb client
 * parses before it sends it. In a process locale like GBK the client read the last byte of a UTF-8
 * character and the quote after it as one character, so the rest of the name ran as a command of
 * the client, like `\!` with a shell command, beside DBackup. Every such call now names the
 * character set of the statement and turns the shell commands of the client off.
 */

const config = { host: "db.example.com", port: 3306, user: "reader", password: "s3cret", disableSsl: false };

/** The name of the audit: a UTF-8 character whose last byte swallows the quote in GBK, then a shell command. */
const HOSTILE = "中` \\! touch ran #";

const options = { database: "appdb", table: "t", page: 1, pageSize: 5 };

describe.each<HostKind>(["direct", "ssh"])("a name of a request in a statement of the MySQL client over a %s host", (kind) => {
    it.each([
        ["a MariaDB client", MARIADB_HELP, "--sandbox"],
        ["a MySQL client", MYSQL_HELP, "--skip-system-command"],
    ])("reads the rows of a table as UTF-8 with the shell commands of %s off", async (_name, help, shellLock) => {
        const host = clientHost({ kind }, help);

        await getTableData(config as never, { ...options, table: HOSTILE, sortBy: HOSTILE, search: "a", searchColumn: HOSTILE, matchMode: "equals" } as never, host);

        const calls = statements(host);
        expect(calls).toHaveLength(3);
        for (const argv of calls) {
            // Right after the login file, which has to come first.
            expect(argv.slice(1, 5)).toEqual([expect.stringMatching(/^--defaults-file=/), NO_LOCAL_INFILE, STATEMENT_CHARSET, shellLock]);
        }
    });

    it("lists the tables of a database the same way", async () => {
        const host = clientHost({ kind });

        await getTables(config as never, "中\\' \\! touch ran #", host);

        expect(statements(host)[0].slice(2, 5)).toEqual([NO_LOCAL_INFILE, STATEMENT_CHARSET, "--sandbox"]);
    });

    it("creates the database of a restore and grants on it the same way", async () => {
        const host = clientHost({ kind });

        await ensureDatabase(config as never, HOSTILE, "admin", "pw", true, [], host);

        const calls = statements(host);
        expect(calls).toHaveLength(2);
        for (const argv of calls) expect(argv.slice(2, 5)).toEqual([NO_LOCAL_INFILE, STATEMENT_CHARSET, "--sandbox"]);
    });

    it("uses the spelling of the character set both clients know", () => {
        expect(STATEMENT_CHARSET).toBe("--default-character-set=utf8mb4");
    });
});

describe("a client that cannot turn its shell commands off", () => {
    const oldClient = (kind: HostKind) => createFakeHost({
        kind,
        onExec: (argv) => argv.includes("--help") ? { stdout: clientHelp("--binary-mode"), code: 0 }
            : argv.includes("--version") ? { stdout: "mysql  Ver 15.1 Distrib 10.3.39-MariaDB\n", code: 0 }
            : { stdout: "" },
    });

    it("never reads a table beside DBackup, and says which client it is", async () => {
        const host = oldClient("direct");

        await expect(getTableData(config as never, options as never, host)).rejects.toThrow(/10\.3\.39-MariaDB cannot turn off its shell and file commands/);
        await expect(getTables(config as never, "appdb", host)).rejects.toThrow(/cannot turn off its shell and file commands/);

        expect(host.calls.exec.filter((argv) => argv.includes("-e"))).toEqual([]);
    });

    it("creates no database beside DBackup and leaves a warning in the log of the restore", async () => {
        const host = oldClient("direct");
        const logs: string[] = [];

        await ensureDatabase(config as never, "shop", "admin", "pw", true, logs, host);

        expect(host.calls.exec.filter((argv) => argv.includes("-e"))).toEqual([]);
        expect(logs[0]).toContain("cannot turn off its shell and file commands");
    });

    it("still reads over SSH, on the server of the connection, with the character set named", async () => {
        const host = oldClient("ssh");

        expect(await queryClientArgs(host, "mariadb")).toEqual([NO_LOCAL_INFILE, STATEMENT_CHARSET]);
        await expect(getTables(config as never, "appdb", host)).resolves.toEqual([]);
    });

    it("is refused beside DBackup as well when it cannot describe itself", async () => {
        const host = createFakeHost({ kind: "direct", onExec: () => ({ code: 2, stdout: "" }) });

        await expect(queryClientArgs(host, "mysql")).rejects.toThrow(/mysql, version unknown cannot turn off/);
    });
});
