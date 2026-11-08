/**
 * What the servers of the lab need before DBackup can use them: the folders of a workspace on the
 * storage servers, the S3 bucket and a Gotify application. Used by the seed and by the end-to-end
 * tests, so it imports nothing of the app.
 */

import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { LabConfig } from "./config";
import { NOTIFY, STORAGE } from "./catalog";
import { execIn } from "./docker";

/**
 * The folders of a workspace on the storage servers. SFTP, SMB and FTP expect the folder of a
 * destination to exist, like a user would have made it once, while the others create it.
 * `ftpService` is the FTP server to make it on, the one of the end-to-end tests has its own.
 */
export async function ensureStorageFolders(config: LabConfig, workspace: string, ftpService: string = STORAGE.ftp.service): Promise<void> {
    const inContainer = async (service: string, command: string) => {
        const result = await execIn(config, service, command);
        if (result.code !== 0) throw new Error(`${command} in ${service} failed:\n${result.stderr || result.stdout}`);
    };
    const home = `${STORAGE.ssh.home}/backups`;
    await inContainer(STORAGE.ssh.service, `mkdir -p ${home}/${workspace} ${home}/${workspace}-rsync && chown -R ${STORAGE.ssh.username}: ${home}`);
    await inContainer(STORAGE.samba.service, `mkdir -p /shares/backups/${workspace} && chown -R ${STORAGE.samba.username} /shares/backups/${workspace}`);
    await inContainer(ftpService, `mkdir -p ${STORAGE.ftp.home}/${workspace} && chown -R ${STORAGE.ftp.username} ${STORAGE.ftp.home}/${workspace}`);
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

/** The token of the Gotify application of a workspace, made on the first run. */
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
