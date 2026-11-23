// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { pack } from "tar-stream";
import {
    extractSelectedDatabases,
    extractedFileOf,
} from "@/lib/adapters/database/common/tar-utils";
import { plainFileNameProblem } from "@/lib/archive/dump-names";
import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { restore as restoreMysql } from "@/lib/adapters/database/mysql/restore";
import { restore as restorePostgres } from "@/lib/adapters/database/postgres/restore";
import { restore as restoreMongo } from "@/lib/adapters/database/mongodb/restore";
import { restore as restoreFirebird } from "@/lib/adapters/database/firebird/restore";
import { restore as restoreAzure } from "@/lib/adapters/database/azure-sql/restore";

/**
 * A backup comes from a destination its owner writes to, so the names of an older multi-database
 * TAR are chosen by whoever wrote it. None of them may write a file outside the temporary folder
 * of the restore, or make the restore read a file of the server and hand it to a tool.
 */

interface Member {
    name: string;
    content?: string;
    type?: "file" | "symlink" | "link" | "directory";
    linkname?: string;
}

let base: string;
let tmpRoot: string;
let previousTmp: string | undefined;

beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "tar-names-"));
    tmpRoot = path.join(base, "tmp");
    await fs.mkdir(tmpRoot);
    previousTmp = process.env.TMPDIR;
    // createTempDir puts the extraction folder under TMPDIR, so `../../x` from there is base/x.
    process.env.TMPDIR = tmpRoot;
});

afterEach(async () => {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    await fs.rm(base, { recursive: true, force: true });
});

async function writeTar(file: string, manifest: unknown, members: Member[]): Promise<string> {
    const tarPack = pack();
    const done = pipeline(tarPack, createWriteStream(file));
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    tarPack.entry({ name: "manifest.json", size: manifestBytes.length }).end(manifestBytes);
    for (const m of members) {
        if (m.type && m.type !== "file") {
            tarPack.entry({ name: m.name, type: m.type, linkname: m.linkname }).end();
            continue;
        }
        const bytes = Buffer.from(m.content ?? "dump");
        tarPack.entry({ name: m.name, size: bytes.length }).end(bytes);
    }
    tarPack.finalize();
    await done;
    return file;
}

function manifestOf(...databases: { name: string; filename: string }[]) {
    return {
        version: 1,
        createdAt: new Date().toISOString(),
        sourceType: "mysql",
        databases: databases.map((d) => ({ ...d, size: 4, format: "sql" })),
        totalSize: 4,
    };
}

async function exists(file: string): Promise<boolean> {
    return fs.lstat(file).then(() => true, () => false);
}

/** Every file below base, relative, so a test sees anything a restore left outside its folder. */
async function filesBelow(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    return entries
        .filter((e) => !e.isDirectory())
        .map((e) => path.relative(base, path.join(e.parentPath, e.name)))
        .sort();
}

describe("plainFileNameProblem", () => {
    it.each(["shop.sql", "a..b.dump", "db with space.archive"])("accepts the plain file name %s", (name) => {
        expect(plainFileNameProblem(name)).toBeNull();
    });

    it.each(["", ".", "..", "../x.sql", "a/b.sql", "a\\b.sql", "/etc/passwd", "x\u0000.sql", undefined, 42])(
        "refuses %j",
        (name) => {
            expect(plainFileNameProblem(name)).not.toBeNull();
        }
    );
});

describe("extractSelectedDatabases with a crafted TAR", () => {
    it("refuses a manifest file name that climbs out and writes nothing outside the folder", async () => {
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: "../planted.sql" }), [
            { name: "../planted.sql", content: "evil" },
        ]);
        const extractDir = path.join(tmpRoot, "x");

        await expect(extractSelectedDatabases(tar, extractDir, [])).rejects.toThrow(/Refusing/);

        expect(await exists(path.join(tmpRoot, "planted.sql"))).toBe(false);
        expect(await filesBelow(base)).toEqual(["evil.tar"]);
    });

    it("refuses an absolute manifest file name", async () => {
        const target = path.join(base, "abs.sql");
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: target }), [
            { name: target, content: "evil" },
        ]);

        await expect(extractSelectedDatabases(tar, path.join(tmpRoot, "x"), [])).rejects.toThrow(/Refusing/);
        expect(await exists(target)).toBe(false);
    });

    it("refuses a selected member that is a symbolic link", async () => {
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: "shop.sql" }), [
            { name: "shop.sql", type: "symlink", linkname: "/etc/passwd" },
        ]);
        const extractDir = path.join(tmpRoot, "x");

        await expect(extractSelectedDatabases(tar, extractDir, [])).rejects.toThrow(/not a regular file/);
        expect(await exists(path.join(extractDir, "shop.sql"))).toBe(false);
    });

    it("refuses a second member of the same name instead of writing through the first", async () => {
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: "shop.sql" }), [
            { name: "shop.sql", content: "first" },
            { name: "shop.sql", content: "second" },
        ]);
        const extractDir = path.join(tmpRoot, "x");

        await expect(extractSelectedDatabases(tar, extractDir, [])).rejects.toThrow(/EEXIST/);
        expect(await fs.readFile(path.join(extractDir, "shop.sql"), "utf-8")).toBe("first");
    });

    it("never writes into a sibling folder whose name starts like the extraction folder", async () => {
        // A bare startsWith(extractDir) would take <dir>-evil/x for a path inside <dir>.
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: "../x-evil/y.sql" }), [
            { name: "../x-evil/y.sql", content: "evil" },
        ]);

        await expect(extractSelectedDatabases(tar, path.join(tmpRoot, "x"), [])).rejects.toThrow(/Refusing/);
        expect(await exists(path.join(tmpRoot, "x-evil", "y.sql"))).toBe(false);
    });

    it("still extracts a well formed backup into its folder", async () => {
        const tar = await writeTar(path.join(base, "good.tar"), manifestOf({ name: "shop", filename: "shop.sql" }), [
            { name: "shop.sql", content: "SELECT 1;" },
        ]);
        const extractDir = path.join(tmpRoot, "x");

        const { manifest, files } = await extractSelectedDatabases(tar, extractDir, []);

        expect(files).toEqual([path.join(extractDir, "shop.sql")]);
        expect(extractedFileOf(files, manifest.databases[0])).toBe(path.join(extractDir, "shop.sql"));
    });
});

describe("extractSelectedDatabases with a hard link", () => {
    it("refuses a selected member that is a hard link", async () => {
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: "shop.sql" }), [
            { name: "shop.sql", type: "link", linkname: "/etc/passwd" },
        ]);

        await expect(extractSelectedDatabases(tar, path.join(tmpRoot, "x"), [])).rejects.toThrow(/not a regular file/);
    });
});

describe("extractedFileOf", () => {
    it("never joins the name of the manifest into a path", () => {
        expect(() =>
            extractedFileOf(["/tmp/x/shop.sql"], { name: "shop", filename: "../../etc/passwd", size: 1, format: "sql" })
        ).toThrow(/Refusing/);
    });

    it("answers a file the extraction did not write as missing", () => {
        expect(() =>
            extractedFileOf(["/tmp/x/shop.sql"], { name: "other", filename: "other.sql", size: 1, format: "sql" })
        ).toThrow(/not found in archive/);
    });
});

type Restore = (config: never, sourcePath: string, host: FakeHost) => Promise<{ success: boolean; error?: string }>;

const ADAPTERS: [string, Restore, Record<string, unknown>][] = [
    ["MySQL", restoreMysql as unknown as Restore, { host: "db", port: 3306, user: "u", password: "p", database: "shop" }],
    ["PostgreSQL", restorePostgres as unknown as Restore, { host: "db", port: 5432, user: "u", password: "p", database: "shop" }],
    ["MongoDB", restoreMongo as unknown as Restore, { host: "db", port: 27017, user: "u", password: "p", database: "shop" }],
    ["Firebird", restoreFirebird as unknown as Restore, { host: "db", port: 3050, user: "u", password: "p", database: "/data/shop.fdb" }],
    ["Azure SQL", restoreAzure as unknown as Restore, { server: "db.database.windows.net", port: 1433, user: "u", password: "p", database: "shop" }],
];

describe.each(ADAPTERS)("%s restore of a crafted older multi-database TAR", (_name, restore, config) => {
    it("reads no file of the server named by the manifest and hands none to a tool", async () => {
        const secret = path.join(base, "outside.sql");
        await fs.writeFile(secret, "secret of the server");
        // From the extraction folder tmp/<prefix>XXXX, ../../outside.sql is the file above.
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: "../../outside.sql" }), [
            { name: "shop.sql", content: "dump" },
        ]);
        const host = createFakeHost({ kind: "ssh" });

        const result = await restore(config as never, tar, host).catch((error: Error) => ({ success: false, error: error.message }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Refusing/);
        const touched = [...host.calls.exec.flat(), ...host.calls.spawn.flat(), ...host.calls.putFile.map((c) => c.localPath)];
        expect(touched.some((arg) => arg.includes("outside.sql"))).toBe(false);
        expect(await fs.readFile(secret, "utf-8")).toBe("secret of the server");
    });

    it("writes no member outside its temporary folder", async () => {
        const tar = await writeTar(path.join(base, "evil.tar"), manifestOf({ name: "shop", filename: "../../planted.sql" }), [
            { name: "../../planted.sql", content: "evil" },
        ]);
        const host = createFakeHost({ kind: "ssh" });

        const result = await restore(config as never, tar, host).catch((error: Error) => ({ success: false, error: error.message }));

        expect(result.success).toBe(false);
        expect(await exists(path.join(base, "planted.sql"))).toBe(false);
        expect(await filesBelow(base)).toEqual(["evil.tar"]);
    });
});
