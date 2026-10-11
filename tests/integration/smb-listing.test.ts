import { afterAll, beforeAll, describe, expect, it } from "vitest";
import SambaClient from "samba-client";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SMBAdapter } from "@/lib/adapters/storage/smb";

// Point these variables at a disposable writable Samba share. Only the unique
// test directory is changed. No storage calls are mocked.
const address = process.env.DBACKUP_SMB_TEST_ADDRESS;
const config = {
    address: address ?? "",
    username: process.env.DBACKUP_SMB_TEST_USERNAME ?? "guest",
    password: process.env.DBACKUP_SMB_TEST_PASSWORD,
    maxProtocol: "SMB3",
    pathPrefix: "listing-test-" + randomUUID(),
};

describe.skipIf(!address)("Integration Tests: SMB listing", () => {
    const client = new SambaClient(config);
    const directories = [config.pathPrefix, config.pathPrefix + "/.hidden folder", config.pathPrefix + "/Team Archives"];
    const names = [
        "x 1 2",
        "report 5 100  final.txt",
        "a  double  space  b.tar",
        "Critical_Backups_2026-10-10_01-20-00_full-000.tar",
        ".hidden folder/hidden.sql",
        "Team Archives/nested.sql",
    ];
    let temporary = "";

    beforeAll(async () => {
        temporary = await mkdtemp(path.join(os.tmpdir(), "smb-listing-"));
        const local = path.join(temporary, "fixture");
        await writeFile(local, "fixture");
        for (const directory of directories) await client.mkdir(directory);
        for (const name of names) await client.sendFile(local, config.pathPrefix + "/" + name);
        await client.execute("setmode", [config.pathPrefix + "/report 5 100  final.txt", "+hs"]);
    });

    afterAll(async () => {
        for (const name of names) await client.deleteFile(config.pathPrefix + "/" + name).catch(() => {});
        for (const directory of [...directories].reverse()) await client.execute("rmdir", [directory]).catch(() => {});
        if (temporary) await rm(temporary, { recursive: true, force: true });
    });

    it("returns every real file exactly once with its full name and valid metadata", async () => {
        const files = await SMBAdapter.list(config);
        expect(files.map((file) => file.path).sort()).toEqual([...names].sort());
        for (const file of files) {
            expect(file.name).toBe(path.posix.basename(file.path));
            expect(file.size).toBe(7);
            expect(Number.isFinite(file.lastModified.getTime())).toBe(true);
        }
    });

    it("browses hidden directories and paths containing spaces", async () => {
        const directories = await SMBAdapter.browseDirectories!(config);
        expect(directories.map((directory) => directory.path).sort()).toEqual([".hidden folder", "Team Archives"]);
        const files = await SMBAdapter.list(config, "Team Archives");
        expect(files.map((file) => file.path)).toEqual(["Team Archives/nested.sql"]);
    });
});
