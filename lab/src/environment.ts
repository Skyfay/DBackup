/**
 * Starts, stops and shows the containers of the lab on the hosts the config places them on, and
 * removes the backups of a workspace again.
 */

import { chmodSync, mkdirSync, rmSync } from "fs";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { GROUPS, type Group, type Host, type LabConfig } from "./config";
import { DATABASES, MSSQL_BACKUP_DIR_REMOTE, NOTIFY, STORAGE, databasesOf } from "./catalog";
import { loadDataset } from "./datasets";
import { composeArgs, dockerArgs, ensureNetwork, run, runOrThrow, type RunResult } from "./docker";
import { localBackupDir, localMssqlBackupDir } from "./folders";

type Write = (line: string) => void;

const isThisMachine = (host: Host) => host.docker === "default";

/** Where SQL Server writes its backups on the host of the databases. */
function mssqlBackupDir(config: LabConfig): string {
    return isThisMachine(config.place.databases) ? localMssqlBackupDir(config) : MSSQL_BACKUP_DIR_REMOTE;
}

/**
 * The folder SQL Server writes to must exist and be writable for its user, uid 10001. It writes
 * its .bak files readable for its group only, so on this machine the folder hands its own group,
 * the one of the user running DBackup, down to every file (setgid).
 */
async function prepareMssqlFolder(config: LabConfig): Promise<void> {
    const host = config.place.databases;
    const folder = mssqlBackupDir(config);
    if (isThisMachine(host)) {
        mkdirSync(folder, { recursive: true });
        chmodSync(folder, 0o2777);
        return;
    }
    await runOrThrow("docker", dockerArgs(host, ["run", "--rm", "-v", `${folder}:${folder}`, "alpine:3.20", "sh", "-c", `mkdir -p ${folder} && chmod 777 ${folder}`]));
}

function composeEnv(config: LabConfig, group: Group): Record<string, string> {
    if (group === "databases") return { LAB_MSSQL_BACKUP_DIR: mssqlBackupDir(config) };
    if (group === "storage") return { LAB_FTP_ADDRESS: config.place.storage.address };
    return {};
}

/** Runs a shell command in a service of the lab, on the host its part runs on. */
export function execIn(config: LabConfig, group: Group, service: string, command: string, input?: string): Promise<RunResult> {
    // The full profile names every service, whichever profile started them.
    return run("docker", composeArgs(config.place[group], group, "full", ["exec", "-T", service, "sh", "-c", command]), { env: composeEnv(config, group), input });
}

/**
 * Starts every part and loads the datasets. A service that does not come up is reported and the
 * rest goes on, so one broken container does not keep the lab from the others. Returns whether
 * everything came up.
 */
export async function up(config: LabConfig, write: Write, full = false): Promise<boolean> {
    const profile = full ? "full" : config.profile;
    let complete = true;
    for (const group of GROUPS) {
        const host = config.place[group];
        write(`Starting ${group} on ${host.name} (${host.address}), profile ${profile}`);
        await ensureNetwork(host);
        if (group === "databases") await prepareMssqlFolder(config);
        const started = await run("docker", composeArgs(host, group, profile, ["up", "-d", "--build", "--wait"]), { env: composeEnv(config, group), inherit: true });
        if (started.code !== 0) {
            complete = false;
            write(`Not every service of ${group} came up, see above and pnpm lab:status`);
        }
    }

    for (const database of databasesOf(profile)) {
        try {
            const loaded = await loadDataset(config.place.databases, profile, database);
            write(`${loaded ? "Loaded the dataset into" : "Dataset already in"} ${database.service}`);
        } catch (error) {
            complete = false;
            const reason = error instanceof Error ? error.message.split("\n").filter(Boolean).pop() : String(error);
            write(`Could not load the dataset into ${database.service}: ${reason}`);
        }
    }
    return complete;
}

export async function down(config: LabConfig, write: Write, removeData = false): Promise<void> {
    for (const group of GROUPS) {
        const host = config.place[group];
        write(`Stopping ${group} on ${host.name}${removeData ? " and removing its data" : ""}`);
        await runOrThrow("docker", composeArgs(host, group, "full", ["down", ...(removeData ? ["-v"] : [])]), { env: composeEnv(config, group), inherit: true });
    }
}

const ADDRESSES: Record<string, number> = {
    ...Object.fromEntries(DATABASES.map((database) => [database.service, database.port])),
    ...Object.fromEntries(Object.values(STORAGE).map((entry) => [entry.service, entry.port])),
    [NOTIFY.mailpit.service]: NOTIFY.mailpit.uiPort,
    [NOTIFY.ntfy.service]: NOTIFY.ntfy.port,
    [NOTIFY.gotify.service]: NOTIFY.gotify.port,
    [NOTIFY.webhook.service]: NOTIFY.webhook.port,
};

export async function status(config: LabConfig, write: Write): Promise<void> {
    for (const group of GROUPS) {
        const host = config.place[group];
        const result = await run("docker", composeArgs(host, group, "full", ["ps", "--all", "--format", "json"]), { env: composeEnv(config, group) });
        const lines = result.stdout.split("\n").filter((line) => line.trim().startsWith("{"));
        write(`${group} on ${host.name}:`);
        if (lines.length === 0) write("  nothing running");
        for (const line of lines) {
            const entry = JSON.parse(line) as { Service: string; State: string; Health?: string };
            const port = ADDRESSES[entry.Service];
            const state = entry.Health ? `${entry.State}, ${entry.Health}` : entry.State;
            write(`  ${entry.Service.padEnd(14)} ${state.padEnd(20)} ${port ? `${host.address}:${port}` : ""}`);
        }
    }
}

/** Removes the backups of a workspace from the Local folder and from every storage server. */
export async function clean(config: LabConfig, write: Write, workspace: string): Promise<void> {
    if (!workspace || workspace.includes("/") || workspace.startsWith(".")) throw new Error(`Not a workspace name: ${workspace}`);
    const local = localBackupDir(config, workspace);
    rmSync(local, { recursive: true, force: true });
    write(`Removed ${local}`);

    const host = config.place.storage;
    const inStorage = (service: string, command: string) => execIn(config, "storage", service, command);
    const removals: [string, string][] = [
        [STORAGE.ssh.service, `rm -rf ${STORAGE.ssh.home}/backups/${workspace} ${STORAGE.ssh.home}/backups/${workspace}-rsync`],
        [STORAGE.webdav.service, `rm -rf /data/${workspace}`],
        [STORAGE.samba.service, `rm -rf /shares/backups/${workspace}`],
        [STORAGE.ftp.service, `rm -rf ${STORAGE.ftp.home}/${workspace}`],
    ];
    for (const [service, command] of removals) {
        const result = await inStorage(service, command);
        write(`${result.code === 0 ? "Removed" : "Could not remove"} the folder of ${workspace} on ${service}`);
    }

    const removed = await removeS3Prefix(host.address, `${workspace}/`).catch(() => null);
    write(removed === null ? `Could not remove the folder of ${workspace} on ${STORAGE.s3.service}` : `Removed ${removed} objects of ${workspace} on ${STORAGE.s3.service}`);
}

/** Deletes every object below a prefix of the lab bucket. Returns how many it deleted. */
async function removeS3Prefix(address: string, prefix: string): Promise<number> {
    const client = new S3Client({
        endpoint: `http://${address}:${STORAGE.s3.port}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: STORAGE.s3.accessKey, secretAccessKey: STORAGE.s3.secretKey },
    });
    let removed = 0;
    try {
        for (;;) {
            const page = await client.send(new ListObjectsV2Command({ Bucket: STORAGE.s3.bucket, Prefix: prefix }));
            const keys = (page.Contents ?? []).map((object) => ({ Key: object.Key! }));
            if (keys.length === 0) return removed;
            await client.send(new DeleteObjectsCommand({ Bucket: STORAGE.s3.bucket, Delete: { Objects: keys } }));
            removed += keys.length;
        }
    } finally {
        client.destroy();
    }
}
