/**
 * The destinations of the lab, each with a folder of this workspace, and a notification channel
 * for every receiver.
 */

import type { LabConfig } from "../config";
import { NOTIFY, STORAGE } from "../catalog";
import { localBackupDir } from "../folders";
import { ensureCredential } from "./records";
import { ensureGotifyToken, ensureS3Bucket, ensureStorageFolders } from "../servers";
import { ensureFolder } from "./setup";
import { ensureSshHostLogin, type Note } from "./sources";

export async function seedDestinations(config: LabConfig, workspace: string, note: Note, log: string[]): Promise<void> {
    const address = config.docker.address;
    const sshHost = await ensureSshHostLogin();

    await note({
        name: "Lab Local",
        type: "storage",
        adapterId: "local-filesystem",
        config: { basePath: ensureFolder(localBackupDir(config, workspace)) },
    }, "local");

    await ensureS3Bucket(address).catch(() => log.push("S3 did not answer, its bucket is made by the next lab:seed after lab:up"));
    await ensureStorageFolders(config, workspace).catch(() => log.push("The storage servers did not answer, their folders are made by the next lab:seed after lab:up"));
    await note({
        name: "Lab S3",
        type: "storage",
        adapterId: "s3-generic",
        config: { endpoint: `http://${address}:${STORAGE.s3.port}`, region: "us-east-1", bucket: STORAGE.s3.bucket, forcePathStyle: true, pathPrefix: workspace },
        primaryCredentialId: await ensureCredential("Lab S3", "ACCESS_KEY", { accessKeyId: STORAGE.s3.accessKey, secretAccessKey: STORAGE.s3.secretKey }),
    }, "s3");

    await note({
        name: "Lab SFTP",
        type: "storage",
        adapterId: "sftp",
        config: { host: address, port: STORAGE.ssh.port, pathPrefix: `${STORAGE.ssh.home}/backups/${workspace}` },
        primaryCredentialId: sshHost,
    }, "sftp");

    await note({
        name: "Lab Rsync",
        type: "storage",
        adapterId: "rsync",
        config: { host: address, port: STORAGE.ssh.port, pathPrefix: `${STORAGE.ssh.home}/backups/${workspace}-rsync` },
        primaryCredentialId: sshHost,
    }, "rsync");

    await note({
        name: "Lab WebDAV",
        type: "storage",
        adapterId: "webdav",
        config: { url: `http://${address}:${STORAGE.webdav.port}/`, pathPrefix: workspace },
        primaryCredentialId: await ensureCredential("Lab WebDAV", "USERNAME_PASSWORD", { username: STORAGE.webdav.username, password: STORAGE.webdav.password }),
    }, "webdav");

    await note({
        name: "Lab SMB",
        type: "storage",
        adapterId: "smb",
        config: { address: `//${address}/${STORAGE.samba.share}`, maxProtocol: "SMB3", pathPrefix: workspace },
        primaryCredentialId: await ensureCredential("Lab SMB", "USERNAME_PASSWORD", { username: STORAGE.samba.username, password: STORAGE.samba.password }),
    }, "smb");

    await note({
        name: "Lab FTP",
        type: "storage",
        adapterId: "ftp",
        config: { host: address, port: STORAGE.ftp.port, tls: false, pathPrefix: `${STORAGE.ftp.home}/${workspace}` },
        primaryCredentialId: await ensureCredential("Lab FTP", "USERNAME_PASSWORD", { username: STORAGE.ftp.username, password: STORAGE.ftp.password }),
    }, "ftp");
}

export async function seedChannels(config: LabConfig, workspace: string, note: Note, log: string[]): Promise<void> {
    const address = config.docker.address;
    await note({
        name: "Lab Mail",
        type: "notification",
        adapterId: "email",
        config: { host: address, port: NOTIFY.mailpit.smtpPort, secure: "none", from: "dbackup-lab@dbackup.lab", to: [config.admin.email] },
        primaryCredentialId: await ensureCredential("Lab Mail", "SMTP", { user: "lab", password: "lab-password" }),
    }, "mail");

    await note({
        name: "Lab ntfy",
        type: "notification",
        adapterId: "ntfy",
        config: { serverUrl: `http://${address}:${NOTIFY.ntfy.port}`, topic: `dbackup-${workspace}`, priority: 3 },
        primaryCredentialId: await ensureCredential("Lab ntfy", "TOKEN", { token: "lab-ntfy-has-no-login" }),
    }, "ntfy");

    // Gotify hands out the token of an application only while it runs.
    const gotifyToken = await ensureGotifyToken(address, workspace).catch(() => null);
    if (gotifyToken) {
        await note({
            name: "Lab Gotify",
            type: "notification",
            adapterId: "gotify",
            config: { serverUrl: `http://${address}:${NOTIFY.gotify.port}`, priority: 5 },
            primaryCredentialId: await ensureCredential("Lab Gotify", "TOKEN", { token: gotifyToken }),
        }, "gotify");
    } else {
        log.push("Gotify did not answer, its channel is made by the next lab:seed after lab:up");
    }

    await note({
        name: "Lab Webhook",
        type: "notification",
        adapterId: "generic-webhook",
        config: { method: "POST", contentType: "application/json" },
        primaryCredentialId: await ensureCredential("Lab Webhook", "WEBHOOK", { url: `http://${address}:${NOTIFY.webhook.port}/${workspace}` }),
    }, "webhook");
}
