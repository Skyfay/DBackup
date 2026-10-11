import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Client from "ssh2-sftp-client";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SFTPAdapter } from "@/lib/adapters/storage/sftp";

// Requires a disposable writable SFTP directory. Only the unique fixture tree
// is created and removed. No client or protocol operation is mocked.
const host = process.env.DBACKUP_SFTP_TEST_HOST;
const config = {
    host: host ?? "",
    port: Number(process.env.DBACKUP_SFTP_TEST_PORT ?? 22),
    username: process.env.DBACKUP_SFTP_TEST_USERNAME ?? "",
    password: process.env.DBACKUP_SFTP_TEST_PASSWORD,
    pathPrefix: path.posix.join(process.env.DBACKUP_SFTP_TEST_ROOT ?? ".", "tree-test-" + randomUUID()),
};

describe.skipIf(!host)("Integration Tests: SFTP source tree", () => {
    const names = Array.from({ length: 24 }, (_, index) => "dir" + index + "/fixture.txt");

    beforeAll(async () => {
        const client = new Client();
        try {
            await client.connect(config);
            for (const name of names) {
                await client.mkdir(path.posix.dirname(config.pathPrefix + "/" + name), true);
                await client.put(Buffer.from("fixture"), config.pathPrefix + "/" + name);
            }
        } finally {
            await client.end();
        }
    });

    afterAll(async () => {
        const client = new Client();
        try {
            await client.connect(config);
            await client.rmdir(config.pathPrefix, true);
        } finally {
            await client.end();
        }
    });

    it("returns the same complete tree for serial and bounded parallel scans without listener warnings", async () => {
        const warnings: Error[] = [];
        const collectWarning = (warning: Error) => warnings.push(warning);
        process.on("warning", collectWarning);
        try {
            const serial = await SFTPAdapter.listTree!(config, "", { concurrency: 1 });
            const parallel = await SFTPAdapter.listTree!(config, "", { concurrency: 24 });
            expect(serial.files.map((file) => file.path).sort()).toEqual([...names].sort());
            expect(parallel.files.map((file) => file.path).sort()).toEqual([...names].sort());
            expect(parallel.files.every((file) => file.size === 7)).toBe(true);
            await new Promise((resolve) => setImmediate(resolve));
            expect(warnings.filter((warning) => warning.name === "MaxListenersExceededWarning")).toEqual([]);
        } finally {
            process.off("warning", collectWarning);
        }
    });
});
