import { describe, it, expect } from "vitest";

import { createFakeHost } from "@/lib/testing/fake-host";
import { withAuthArgs, buildConnectionArgs, NO_LOCAL_INFILE } from "@/lib/adapters/database/mysql/args";
import { test as testConnection, getDatabases, getDatabasesWithStats } from "@/lib/adapters/database/mysql/connection";
import { getTables } from "@/lib/adapters/database/mysql/browser";
import { MySQLSchema, MariaDBSchema } from "@/lib/adapters/definitions";
import { AdapterError } from "@/lib/logging/errors";
import type { HostKind } from "@/lib/transport/types";

/**
 * The MySQL and MariaDB tools read their password from an option file DBackup writes. A line break
 * in the password would add option lines every one of these tools reads, so it never reaches the
 * file, and a client never reads an option file of the server DBackup runs on without one.
 */

const config = { host: "db.example.com", port: 3306, user: "backup", password: "s3cret", disableSsl: false };

describe.each<HostKind>(["direct", "ssh"])("the option file of the MySQL tools over a %s host", (kind) => {
    it.each(["pw\nplugin-dir=/tmp/evil", "pw\r\ninit-command=DROP DATABASE x", "pw\0rest"])(
        "refuses a password with a line break or a NUL before the file is written",
        async (password) => {
            const host = createFakeHost({ kind });
            let ran = false;
            const attempt = withAuthArgs(host, password, async () => { ran = true; });

            await expect(attempt).rejects.toBeInstanceOf(AdapterError);
            await expect(attempt).rejects.toThrow("line break or a NUL");
            await expect(attempt).rejects.not.toThrow(password);
            expect(host.calls.tempFiles).toEqual([]);
            expect(ran).toBe(false);
        },
    );

    it("writes a password with quotes and backslashes into the file escaped, on one line", async () => {
        const host = createFakeHost({ kind });
        await withAuthArgs(host, 'a"b\\c', async (args) => {
            expect(args).toEqual([expect.stringMatching(/^--defaults-file=/)]);
        });
        expect(host.calls.tempFiles[0].content).toBe('[client]\npassword="a\\"b\\\\c"\n');
    });

    it("refuses a stored port that is no port before it reaches the client", () => {
        const host = createFakeHost({ kind });
        expect(() => buildConnectionArgs({ ...config, port: "3306 --init-command=x" } as never, host)).toThrow("whole number from 1 to 65535");
        expect(() => buildConnectionArgs({ ...config, port: 70000 } as never, host)).toThrow("whole number from 1 to 65535");
        expect(buildConnectionArgs({ ...config, port: "3307" } as never, host)).toEqual(expect.arrayContaining(["-P", "3307"]));
        expect(buildConnectionArgs({ ...config, port: 0 } as never, host)).toEqual(expect.arrayContaining(["-P", "3306"]));
    });

    it("turns off local files on every call of the mysql client, so a server never reads one of this machine", async () => {
        const host = createFakeHost({ kind, onExec: () => ({ stdout: "8.0.44\n" }) });
        await testConnection(config as never, host);
        await getDatabases(config as never, host);
        await getDatabasesWithStats(config as never, host);
        await getTables(config as never, "shop", host);

        const clientCalls = host.calls.exec.filter((argv) => argv[0] === "mariadb" || argv[0] === "mysql");
        expect(clientCalls.length).toBeGreaterThanOrEqual(5);
        for (const argv of clientCalls.filter((call) => !call.includes("--version"))) {
            // Right after the login file, which has to come first.
            expect(argv[1]).toMatch(/^--defaults-file=/);
            expect(argv[2]).toBe(NO_LOCAL_INFILE);
        }
    });
});

describe("a login without a password", () => {
    it("reads no option file of the server DBackup runs on in direct mode", async () => {
        const host = createFakeHost({ kind: "direct" });
        await withAuthArgs(host, undefined, async (args) => expect(args).toEqual(["--no-defaults"]));
        await withAuthArgs(host, "", async (args) => expect(args).toEqual(["--no-defaults"]));
        expect(host.calls.tempFiles).toEqual([]);
    });

    it("keeps the option files of an SSH server, which belong to whoever runs it", async () => {
        const host = createFakeHost({ kind: "ssh" });
        await withAuthArgs(host, undefined, async (args) => expect(args).toEqual([]));
    });

    it("puts --no-defaults first on a connection test in direct mode", async () => {
        const host = createFakeHost({ kind: "direct", onExec: () => ({ stdout: "8.0.44\n" }) });
        await testConnection({ ...config, password: undefined } as never, host);
        const calls = host.calls.exec.filter((argv) => !argv.includes("--version"));
        expect(calls.length).toBeGreaterThan(0);
        for (const argv of calls) expect(argv[1]).toBe("--no-defaults");
    });
});

describe.each([["MySQL", MySQLSchema], ["MariaDB", MariaDBSchema]])("the %s form", (_name, schema) => {
    it("refuses a password with a line break or a NUL on save and names no value", () => {
        for (const password of ["pw\nx", "pw\rx", "pw\0x"]) {
            const result = schema.safeParse({ host: "db", user: "backup", password });
            expect(result.success).toBe(false);
            expect(JSON.stringify(result.error?.issues)).toContain("line break or a NUL");
            expect(JSON.stringify(result.error?.issues)).not.toContain("pw");
        }
    });

    it("keeps any other password", () => {
        expect(schema.safeParse({ host: "db", user: "backup", password: 'p"w\\#; x' }).success).toBe(true);
        expect(schema.safeParse({ host: "db", user: "backup" }).success).toBe(true);
    });
});
