import { describe, it, expect } from "vitest";

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { openMongoMeta } from "@/lib/adapters/database/mongodb/meta";
import { ShellMongoMeta } from "@/lib/adapters/database/mongodb/meta/shell-meta";
import { DriverMongoMeta } from "@/lib/adapters/database/mongodb/meta/driver-meta";

const config = { host: "mongo.internal", port: 27017, user: "root", password: "secret" };

/** The --eval script from a recorded mongosh call. */
function scriptOf(argv: string[]): string {
    return argv[argv.indexOf("--eval") + 1] ?? "";
}

function shellHost(stdout: string, code = 0): FakeHost {
    return createFakeHost({ kind: "ssh", onExec: () => ({ stdout, code }) });
}

describe("openMongoMeta", () => {
    it("uses the native driver when the server is directly reachable", () => {
        expect(openMongoMeta(config as never, createFakeHost({ kind: "direct" })))
            .toBeInstanceOf(DriverMongoMeta);
    });

    it("uses mongosh when the server is only reachable from the SSH host", () => {
        // mongosh is not in the DBackup image, so direct mode cannot use it, and
        // there is no MongoDB tunnel yet, so SSH mode cannot use the driver.
        expect(openMongoMeta(config as never, createFakeHost({ kind: "ssh" })))
            .toBeInstanceOf(ShellMongoMeta);
    });
});

describe("ShellMongoMeta", () => {
    it("passes the script as one argument instead of building a shell command", async () => {
        // The old implementation pasted the script into a command line wrapped in
        // single quotes, so a database name containing one could terminate it.
        const host = shellHost('["shop"]');
        await new ShellMongoMeta(config as never, host).listDatabaseNames();

        const argv = host.calls.exec[0];
        expect(argv[0]).toBe("mongosh");
        expect(argv).toContain("--eval");
        expect(scriptOf(argv)).toContain("listDatabases");
    });

    it("embeds a database name as a JavaScript literal", async () => {
        const host = shellHost("[]");
        await new ShellMongoMeta(config as never, host).listCollections(`it's "quoted"`);

        expect(scriptOf(host.calls.exec[0])).toContain(String.raw`"it's \"quoted\""`);
    });

    it("filters MongoDB's own databases out of the listing", async () => {
        const host = shellHost('["admin","config","local","shop"]');
        expect(await new ShellMongoMeta(config as never, host).listDatabaseNames()).toEqual(["shop"]);
    });

    it("filters MongoDB's own databases out of the stats", async () => {
        const host = shellHost('[{"name":"admin","sizeOnDisk":1,"collectionCount":1},{"name":"shop","sizeOnDisk":2048,"collectionCount":4}]');

        expect(await new ShellMongoMeta(config as never, host).databaseStats())
            .toEqual([{ name: "shop", sizeOnDisk: 2048, collectionCount: 4 }]);
    });

    it("ignores banner lines printed before the payload", async () => {
        const host = shellHost('Current Mongosh Log ID: abc\nConnecting to: mongodb://...\n["shop"]\n');
        expect(await new ShellMongoMeta(config as never, host).listDatabaseNames()).toEqual(["shop"]);
    });

    it("reports the server error when mongosh fails", async () => {
        const host = createFakeHost({ kind: "ssh", onExec: () => ({ code: 1, stderr: "MongoServerError: Authentication failed" }) });

        await expect(new ShellMongoMeta(config as never, host).listDatabaseNames())
            .rejects.toThrow(/Failed to list databases.*Authentication failed/);
    });

    it("reports missing output rather than crashing on a parse", async () => {
        const host = shellHost("no json here");
        await expect(new ShellMongoMeta(config as never, host).listDatabaseNames())
            .rejects.toThrow(/no JSON output from mongosh/);
    });

    it("builds a paged find with the filter, sort, skip and limit inline", async () => {
        const host = shellHost('{"total":2,"docs":[]}');

        await new ShellMongoMeta(config as never, host).findPage("shop", "users", {
            filter: { name: { $regex: "ann", $options: "i" } },
            sort: { name: -1 },
            skip: 20,
            limit: 10,
        });

        const script = scriptOf(host.calls.exec[0]);
        expect(script).toContain('{"name":{"$regex":"ann","$options":"i"}}');
        expect(script).toContain('.sort({"name":-1})');
        expect(script).toContain(".skip(20).limit(10)");
    });

    it("reports the raw server version", async () => {
        const host = createFakeHost({ kind: "ssh", onExec: () => ({ stdout: "7.0.5\n" }) });
        expect(await new ShellMongoMeta(config as never, host).serverVersion()).toBe("7.0.5");
    });

    it("cannot probe write access, so it says so", async () => {
        expect(new ShellMongoMeta(config as never, shellHost("")).checkWritable()).toBeNull();
    });

    it("keeps the password out of the argv of mongosh, in a file of mode 0600 the script loads", async () => {
        const host = shellHost('["shop"]');
        await new ShellMongoMeta(config as never, host).listDatabaseNames();
        const versionHost = createFakeHost({ kind: "ssh", onExec: () => ({ stdout: "7.0.5\n" }) });
        await new ShellMongoMeta(config as never, versionHost).serverVersion();

        for (const fake of [host, versionHost]) {
            const argv = fake.calls.exec[0];
            expect(argv.join(" ")).not.toContain("secret");
            expect(argv).toContain("--nodb");
            const [file] = fake.calls.tempFiles;
            expect(file.mode).toBe(0o600);
            expect(file.content).toBe('db = connect("mongodb://root:secret@mongo.internal:27017/?authSource=admin&directConnection=true");\n');
            expect(scriptOf(argv).startsWith(`load(${JSON.stringify(file.path)});`)).toBe(true);
            expect(fake.calls.removed).toContain(file.path);
        }
    });

    it("resolves the mongosh binary once and reuses it", async () => {
        const host = shellHost("[]");
        const meta = new ShellMongoMeta(config as never, host);

        await meta.listDatabaseNames();
        await meta.listDatabaseNames();

        expect(host.calls.which).toHaveLength(1);
    });
});
