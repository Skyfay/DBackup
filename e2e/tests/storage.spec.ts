/**
 * Every destination through DBackup: one backup of a SQLite database inside DBackup to all of
 * them, under a job name with spaces and Unicode. Each destination passes Test connection, lists
 * the backup, hands it back for a restore with the same content and deletes it again.
 */

import { expect, test, type APIRequestContext } from "@playwright/test";
import { STORAGE } from "../../lab/src/catalog";
import { sqliteDatabase } from "../../lab/src/engines/sqlite";
import { ensureS3Bucket, ensureStorageFolders } from "../../lab/src/servers";
import { App, problemOf, unique, type Connection, type Execution } from "../support/app";
import { expectSameContentAfterRestore, sqliteInApp } from "../support/backups";
import { ADMIN_STATE, BASE_URL, lab } from "../support/environment";
import type { Target } from "../support/targets";

test.describe.configure({ mode: "serial" });

const name = unique();

/** Every destination in the network of the lab, each in a folder of this run. */
const DESTINATIONS: { key: string; connection: Connection; login?: { type: "USERNAME_PASSWORD" | "SSH_KEY" | "ACCESS_KEY"; data: Record<string, unknown> } }[] = [
    { key: "local", connection: { adapterId: "local-filesystem", config: { basePath: `/data/e2e/${name}/local` } } },
    {
        key: "s3",
        connection: { adapterId: "s3-generic", config: { endpoint: `http://${STORAGE.s3.service}:8333`, region: "us-east-1", bucket: STORAGE.s3.bucket, forcePathStyle: true, pathPrefix: name } },
        login: { type: "ACCESS_KEY", data: { accessKeyId: STORAGE.s3.accessKey, secretAccessKey: STORAGE.s3.secretKey } },
    },
    {
        key: "sftp",
        connection: { adapterId: "sftp", config: { host: STORAGE.ssh.service, port: 22, pathPrefix: `${STORAGE.ssh.home}/backups/${name}` } },
        login: { type: "SSH_KEY", data: { username: STORAGE.ssh.username, authType: "password", password: STORAGE.ssh.password } },
    },
    {
        key: "rsync",
        connection: { adapterId: "rsync", config: { host: STORAGE.ssh.service, port: 22, pathPrefix: `${STORAGE.ssh.home}/backups/${name}-rsync` } },
        login: { type: "SSH_KEY", data: { username: STORAGE.ssh.username, authType: "password", password: STORAGE.ssh.password } },
    },
    {
        key: "webdav",
        connection: { adapterId: "webdav", config: { url: `http://${STORAGE.webdav.service}:8080/`, pathPrefix: name } },
        login: { type: "USERNAME_PASSWORD", data: { username: STORAGE.webdav.username, password: STORAGE.webdav.password } },
    },
    {
        key: "smb",
        connection: { adapterId: "smb", config: { address: `//${STORAGE.samba.service}/${STORAGE.samba.share}`, maxProtocol: "SMB3", pathPrefix: name } },
        login: { type: "USERNAME_PASSWORD", data: { username: STORAGE.samba.username, password: STORAGE.samba.password } },
    },
    {
        key: "ftp",
        connection: { adapterId: "ftp", config: { host: "ftp-e2e", port: 21, tls: false, pathPrefix: `${STORAGE.ftp.home}/${name}` } },
        login: { type: "USERNAME_PASSWORD", data: { username: STORAGE.ftp.username, password: STORAGE.ftp.password } },
    },
];

let request: APIRequestContext;
let app: App;
let target: Target;
let sourceId: string;
let backup: Execution;
const ids = new Map<string, string>();
const connections = new Map<string, Connection>();

test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext({ baseURL: BASE_URL, storageState: ADMIN_STATE });
    app = new App(request);

    // SFTP, SMB and FTP expect the folder of a destination to exist, like a person made it once.
    await ensureStorageFolders(lab, name, "ftp-e2e");
    await ensureS3Bucket(lab.docker.address);

    const file = await sqliteInApp(name);
    target = { key: "sqlite", adapterId: "sqlite", config: () => ({ mode: "local", path: file }), service: "app", database: sqliteDatabase(file) };
    sourceId = await app.connection({ name: `${name} sqlite`, type: "database", adapterId: "sqlite", config: target.config(lab) });

    for (const destination of DESTINATIONS) {
        const connection = { ...destination.connection };
        if (destination.login) connection.primaryCredentialId = await app.credential(`${name} ${destination.key}`, destination.login.type, destination.login.data);
        connections.set(destination.key, connection);
        ids.set(destination.key, await app.connection({ ...connection, name: `${name} ${destination.key}`, type: "storage" }));
    }

    const job = await app.job(`${name} Bäckerei Zoë`, sourceId, [...ids.values()], await app.vaultKey());
    backup = await app.backUp(job.id);
});

test.afterAll(async () => {
    await request?.dispose();
});

test("[storage] one backup reaches every destination", () => {
    expect(backup.status, problemOf(backup)).toBe("Success");
});

for (const destination of DESTINATIONS) {
    test(`[storage] ${destination.key} passes Test connection, lists the backup, restores it and deletes it`, async () => {
        const id = ids.get(destination.key)!;
        const tested = await app.testConnection(connections.get(destination.key)!);
        expect(tested.success, tested.message).toBe(true);

        const listed = (await app.files(id)).find((file) => file.path === backup.path);
        expect(listed, `${backup.path} on ${destination.key}`).toBeTruthy();
        expect(listed!.size).toBeGreaterThan(0);

        await expectSameContentAfterRestore(app, target, sourceId, id, backup, `from_${destination.key}`);

        await app.deleteFile(id, backup.path!);
        expect((await app.files(id)).map((file) => file.path)).not.toContain(backup.path);
    });
}
