// @vitest-environment node
/**
 * A download of a storage counts only once a regular file lies at its local path. A customer owns
 * the server of a connection and what lies in its destination, and a transfer like rsync with `-a`
 * recreated a link of the server as a link here. Every reader of the temp file, the download to the
 * browser included, then followed it into a file of the DBackup server.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StorageAdapter, StorageSession } from "@/lib/core/interfaces";

const wrapped = vi.hoisted(() => new Set<unknown>());
vi.mock("@/lib/adapters/storage/common/downloaded-file", async (importActual) => {
    const actual = await importActual<typeof import("@/lib/adapters/storage/common/downloaded-file")>();
    return {
        ...actual,
        withCheckedDownloads: (adapter: StorageAdapter) => {
            const checked = actual.withCheckedDownloads(adapter);
            wrapped.add(checked);
            return checked;
        },
    };
});

import { DownloadedFileError, withCheckedDownloads } from "@/lib/adapters/storage/common/downloaded-file";
import { registerAdapters } from "@/lib/adapters";
import { registry } from "@/lib/core/registry";
import { localFileSource } from "@/lib/archive/sources";
import { tempFileDownloadResponse } from "@/lib/server/temp-file-response";
import { calculateFileChecksum } from "@/lib/crypto/checksum";

let root: string;
let secret: string;

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "downloaded-file-")));
    secret = path.join(root, "shadow");
    fs.writeFileSync(secret, "SECRET OF THE SERVER");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A storage whose download leaves what `lay` puts at the local path and reports success. */
function storageThat(lay: (localPath: string) => void, ok = true): StorageAdapter {
    return {
        id: "fake",
        type: "storage",
        name: "Fake",
        configSchema: {} as StorageAdapter["configSchema"],
        upload: async () => true,
        download: async (_config, _remote, localPath) => {
            lay(localPath);
            return ok;
        },
        list: async () => [],
        delete: async () => true,
        openSession: async () => ({
            upload: async () => true,
            download: async (_remote: string, localPath: string) => {
                lay(localPath);
                return ok;
            },
            close: async () => { },
        }),
    } as StorageAdapter;
}

const local = (name: string) => path.join(root, name);

describe("a download that leaves no regular file", () => {
    it("fails on a link to a file of the server and removes the link, not its target", async () => {
        const adapter = withCheckedDownloads(storageThat((p) => fs.symlinkSync(secret, p)));

        await expect(adapter.download({}, "Job/backup.tar", local("link.tar"))).rejects.toBeInstanceOf(DownloadedFileError);
        expect(fs.lstatSync(local("link.tar"), { throwIfNoEntry: false })).toBeUndefined();
        expect(fs.readFileSync(secret, "utf-8")).toBe("SECRET OF THE SERVER");
    });

    it("fails on a folder and removes it", async () => {
        const adapter = withCheckedDownloads(storageThat((p) => fs.mkdirSync(path.join(p, "inner"), { recursive: true })));

        await expect(adapter.download({}, "Job/backup.tar", local("folder.tar"))).rejects.toThrow(/a folder/);
        expect(fs.existsSync(local("folder.tar"))).toBe(false);
    });

    it("fails when the storage reported success and wrote nothing, like rsync skipping a link", async () => {
        const adapter = withCheckedDownloads(storageThat(() => { }));

        await expect(adapter.download({}, "Job/backup.tar", local("none.tar"))).rejects.toThrow(/no file/);
    });

    it("fails a download of a session the same way", async () => {
        const adapter = withCheckedDownloads(storageThat((p) => fs.symlinkSync(secret, p)));
        const session = (await adapter.openSession!({})) as StorageSession;

        await expect(session.download!("a.txt", local("session-link"))).rejects.toBeInstanceOf(DownloadedFileError);
        expect(fs.lstatSync(local("session-link"), { throwIfNoEntry: false })).toBeUndefined();
    });

    it("keeps a regular file and a failed download as they were", async () => {
        const adapter = withCheckedDownloads(storageThat((p) => fs.writeFileSync(p, "backup")));
        expect(await adapter.download({}, "Job/backup.tar", local("plain.tar"))).toBe(true);
        expect(fs.readFileSync(local("plain.tar"), "utf-8")).toBe("backup");

        const failing = withCheckedDownloads(storageThat(() => { }, false));
        expect(await failing.download({}, "Job/backup.tar", local("failed.tar"))).toBe(false);
    });
});

describe("the registry", () => {
    it("holds every storage adapter with its downloads checked", () => {
        registerAdapters();
        const storages = registry.getStorageAdapters();
        expect(storages.length).toBeGreaterThan(5);
        for (const adapter of storages) expect(wrapped.has(adapter), adapter.id).toBe(true);
    });
});

describe("the readers of a downloaded file", () => {
    it("never follow a link into a file of the server", async () => {
        const link = local("reader-link");
        fs.symlinkSync(secret, link);

        await expect(localFileSource(link)).rejects.toThrow(/no regular file/);
        await expect(calculateFileChecksum(link)).rejects.toMatchObject({ code: "ELOOP" });
        expect(() => tempFileDownloadResponse(link, "backup.tar", "application/octet-stream")).toThrow(/symbolic link/);
        expect(fs.readFileSync(secret, "utf-8")).toBe("SECRET OF THE SERVER");
    });

    it("send a regular file as before", async () => {
        const file = local("served.tar");
        fs.writeFileSync(file, "payload");
        const response = tempFileDownloadResponse(file, "served.tar", "application/octet-stream");
        expect(response.headers.get("Content-Length")).toBe("7");
        expect(await response.text()).toBe("payload");
    });
});
