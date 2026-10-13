import { afterAll, beforeAll, describe, expect, it } from "vitest";
import SambaClient from "samba-client";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SMBAdapter } from "@/lib/adapters/storage/smb";

// Use disposable writable and read-only Samba shares. This suite only changes
// its unique directory. Protocol operations and their output are not mocked.
const address = process.env.DBACKUP_SMB_TEST_ADDRESS;
const readonlyAddress = process.env.DBACKUP_SMB_READONLY_TEST_ADDRESS;
const prefix = "parents-test-" + randomUUID();
const config = {
    address: address ?? "",
    username: process.env.DBACKUP_SMB_TEST_USERNAME ?? "guest",
    password: process.env.DBACKUP_SMB_TEST_PASSWORD,
    maxProtocol: "SMB3",
    pathPrefix: "/" + prefix,
};

describe.skipIf(!address)("Integration Tests: SMB upload parents", () => {
    const client = new SambaClient(config);
    let temporary = "";
    let fixture = "";
    const files = ["restore/nested/one.sql", "restore/nested/two.sql"];

    beforeAll(async () => {
        temporary = await mkdtemp(path.join(os.tmpdir(), "smb-parents-"));
        fixture = path.join(temporary, "fixture");
        await writeFile(fixture, "fixture");
        await client.mkdir(prefix);
    });

    afterAll(async () => {
        for (const name of files) await client.deleteFile(prefix + "/" + name).catch(() => {});
        for (const name of ["restore/nested", "restore", ".dbackup/test", ".dbackup"]) {
            await client.execute("rmdir", [prefix + "/" + name]).catch(() => {});
        }
        await client.execute("rmdir", [prefix]).catch(() => {});
        if (temporary) await rm(temporary, { recursive: true, force: true });
    });

    it("creates nested parents for share-relative uploads and reuses the session", async () => {
        const session = await SMBAdapter.openSession!(config);
        try {
            for (const name of files) expect(await session.upload(fixture, "/" + name)).toBe(true);
        } finally {
            await session.close();
        }
        for (const name of files) {
            const downloaded = path.join(temporary, path.posix.basename(name));
            await client.getFile(prefix + "/" + name, downloaded);
            expect(await readFile(downloaded, "utf8")).toBe("fixture");
        }
        // A fresh session encounters existing directories reported as collisions.
        expect(await SMBAdapter.upload(config, fixture, "/" + files[0])).toBe(true);
    });

    it("uses the same parent creation for the connection write/delete probe", async () => {
        expect((await SMBAdapter.test!(config)).success).toBe(true);
    });

    it.skipIf(!readonlyAddress)("reports a real read-only share mkdir failure before upload", async () => {
        const messages: string[] = [];
        const result = await SMBAdapter.upload(
            { ...config, address: readonlyAddress!, pathPrefix: "" },
            fixture,
            prefix + "/blocked/file.sql",
            undefined,
            (message) => messages.push(message),
        );
        expect(result).toBe(false);
        expect(messages.join("\n")).toContain("Cannot create SMB destination parent");
        expect(messages.join("\n")).toContain("NT_STATUS_ACCESS_DENIED");
        expect(messages.some((message) => message.startsWith("Starting SMB upload"))).toBe(false);
    });
});
