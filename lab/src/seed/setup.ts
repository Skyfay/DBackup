/**
 * What the connections of the seed need to exist outside of DBackup: the local folders, the local
 * SQLite database, a folder of files to back up, the S3 bucket and a Gotify application.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { REPO_ROOT, type LabConfig } from "../config";
import { NOTIFY, STORAGE } from "../catalog";
import { composeArgs, runOrThrow } from "../docker";

export function ensureFolder(folder: string): string {
    mkdirSync(folder, { recursive: true });
    return folder;
}

/** A SQLite database of the dataset for the local mode, made with the sqlite3 DBackup needs anyway. */
export async function ensureLocalSqlite(file: string): Promise<string> {
    if (existsSync(file)) return file;
    ensureFolder(path.dirname(file));
    const dataset = readFileSync(path.join(REPO_ROOT, "lab", "datasets", "sqlite.sql"), "utf8");
    await runOrThrow("sqlite3", [file], { input: dataset });
    return file;
}

/** A few files for the directory backups, with a nested folder, a name with Unicode and binary data. */
export function ensureFilesFolder(folder: string): string {
    if (existsSync(path.join(folder, "README.txt"))) return folder;
    ensureFolder(path.join(folder, "docs", "2026"));
    writeFileSync(path.join(folder, "README.txt"), "Files of the DBackup dev lab, backed up by the Lab Files job.\n");
    writeFileSync(path.join(folder, "docs", "2026", "Grüezi 🦊.txt"), "Unicode in the name and in the content: Zoë, 李雷.\n");
    writeFileSync(path.join(folder, "docs", "notes.md"), "# Notes\n\nChange this file between two runs to see an incremental backup pick it up.\n");
    writeFileSync(path.join(folder, "random.bin"), Buffer.from(Array.from({ length: 64 * 1024 }, (_, index) => (index * 7919) % 256)));
    return folder;
}

/**
 * The folders of a workspace on the storage servers. SFTP, SMB and FTP expect the folder of a
 * destination to exist, like a user would have made it once, while the others create it.
 */
export async function ensureStorageFolders(config: LabConfig, workspace: string): Promise<void> {
    const inContainer = (service: string, command: string) =>
        runOrThrow("docker", composeArgs(config.place.storage, "storage", config.profile, ["exec", "-T", service, "sh", "-c", command]));
    const home = `${STORAGE.ssh.home}/backups`;
    await inContainer(STORAGE.ssh.service, `mkdir -p ${home}/${workspace} ${home}/${workspace}-rsync && chown -R ${STORAGE.ssh.username}: ${home}`);
    await inContainer(STORAGE.samba.service, `mkdir -p /shares/backups/${workspace} && chown -R ${STORAGE.samba.username} /shares/backups/${workspace}`);
    await inContainer(STORAGE.ftp.service, `mkdir -p ${STORAGE.ftp.home}/${workspace} && chown -R ${STORAGE.ftp.username} ${STORAGE.ftp.home}/${workspace}`);
}

export async function ensureS3Bucket(address: string): Promise<void> {
    const client = new S3Client({
        endpoint: `http://${address}:${STORAGE.s3.port}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: STORAGE.s3.accessKey, secretAccessKey: STORAGE.s3.secretKey },
    });
    try {
        await client.send(new HeadBucketCommand({ Bucket: STORAGE.s3.bucket }));
    } catch {
        await client.send(new CreateBucketCommand({ Bucket: STORAGE.s3.bucket }));
    } finally {
        client.destroy();
    }
}

/** The token of the Gotify application of this workspace, made on the first run. */
export async function ensureGotifyToken(address: string, workspace: string): Promise<string> {
    const base = `http://${address}:${NOTIFY.gotify.port}`;
    const headers = {
        Authorization: `Basic ${Buffer.from(`${NOTIFY.gotify.username}:${NOTIFY.gotify.password}`).toString("base64")}`,
        "Content-Type": "application/json",
    };
    const name = `DBackup ${workspace}`;
    const list = await fetch(`${base}/application`, { headers });
    if (!list.ok) throw new Error(`Gotify answered ${list.status} when listing its applications`);
    const found = ((await list.json()) as { id: number; name: string; token?: string }[]).find((application) => application.name === name);
    if (found?.token) return found.token;
    // Newer versions of Gotify show the token of an application only when it is made, so one
    // made by an earlier seed is made again.
    if (found) await fetch(`${base}/application/${found.id}`, { method: "DELETE", headers });

    const created = await fetch(`${base}/application`, { method: "POST", headers, body: JSON.stringify({ name, description: "Messages of the DBackup dev lab" }) });
    if (!created.ok) throw new Error(`Gotify answered ${created.status} when creating an application`);
    return ((await created.json()) as { token: string }).token;
}
