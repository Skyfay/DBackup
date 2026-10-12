/**
 * Starts and stops the lab on its Docker host, and removes the backups of a workspace again.
 */

import { chmodSync, mkdirSync, rmSync } from "fs";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { GROUPS, isThisMachine, type LabConfig } from "./config";
import { STORAGE, databasesOf } from "./catalog";
import { describeDown, expectedServices, isUp, serviceStates } from "./containers";
import { loadDataset } from "./datasets";
import { compose, dockerArgs, execIn, mssqlBackupGroup, runOrThrow } from "./docker";
import { mssqlBackupDir } from "./engines/mssql";
import { localBackupDir } from "./folders";

type Write = (line: string) => void;

/**
 * The folder SQL Server writes to must exist and be writable for its user, uid 10001. It writes
 * its .bak files readable for its group only, so the folder hands the group DBackup reads with
 * down to every file (setgid), see mssqlBackupGroup.
 */
export async function prepareMssqlFolder(config: LabConfig): Promise<void> {
    const folder = mssqlBackupDir(config);
    if (isThisMachine(config.docker)) {
        mkdirSync(folder, { recursive: true });
        chmodSync(folder, 0o2777);
        return;
    }
    const group = mssqlBackupGroup(config);
    await runOrThrow("docker", dockerArgs(config.docker, ["run", "--rm", "-v", `${folder}:${folder}`, "alpine:3.20", "sh", "-c", `mkdir -p ${folder} && chgrp ${group} ${folder} && chmod 2777 ${folder}`]));
}

/** The last lines of a command that failed, which is where Compose says why. */
const tail = (text: string) => text.trim().split("\n").slice(-3).map((line) => `    ${line}`).join("\n");

/**
 * Starts the lab and loads the datasets. A service that does not come up is reported and the rest
 * goes on, so one broken container does not keep the lab from the others. Prints a line per part
 * and one per problem, Compose itself stays quiet. Returns whether everything came up.
 */
export async function up(config: LabConfig, write: Write, full = false): Promise<boolean> {
    const profile = full ? "full" : config.profile;
    const before = await serviceStates(config).catch(() => new Map());
    write(`Starting the lab on ${config.docker.name} (${config.docker.address}), profile ${profile}${before.size === 0 ? ". The first start pulls the images, which takes a few minutes" : ""}`);
    await prepareMssqlFolder(config);
    const started = await compose(config, ["--progress", "quiet", "up", "-d", "--build", "--wait"], { profile });

    let complete = started.code === 0;
    const states = await serviceStates(config);
    const running = new Set<string>();
    let reasons = false;
    for (const group of GROUPS) {
        const expected = expectedServices(group, profile);
        const down = expected.filter((entry) => !isUp(states.get(entry.service)));
        for (const entry of expected) if (isUp(states.get(entry.service))) running.add(entry.service);
        write(`  ${group}: ${expected.length - down.length} of ${expected.length} up`);
        for (const entry of down) write(`  ✗ ${entry.service}: ${await describeDown(config, entry, states.get(entry.service))}`);
        if (down.length > 0) complete = false;
        reasons ||= down.length > 0;
    }
    if (started.code !== 0 && !reasons) write(`  Compose failed:\n${tail(started.stderr || started.stdout)}`);

    const loaded: string[] = [];
    const present: string[] = [];
    for (const database of databasesOf(profile)) {
        if (!running.has(database.service)) continue;
        try {
            (await loadDataset(config, database) ? loaded : present).push(database.service);
        } catch (error) {
            complete = false;
            const reason = error instanceof Error ? error.message.split("\n").filter(Boolean).pop() : String(error);
            write(`  ✗ test data of ${database.service}: ${reason}`);
        }
    }
    write(`Test data: ${loaded.length ? `loaded into ${loaded.join(", ")}, ` : ""}${present.length} already had it`);
    write(complete ? "The lab is up. pnpm lab:status shows the details." : "Not everything came up, see above. pnpm lab:status shows the details.");
    return complete;
}

export async function down(config: LabConfig, write: Write, removeData = false): Promise<void> {
    write(`Stopping the lab on ${config.docker.name}${removeData ? " and removing its data" : ""}`);
    // The e2e profile takes along what an end-to-end run with E2E_KEEP=1 left running.
    const result = await compose(config, ["--profile", "e2e", "--progress", "quiet", "down", ...(removeData ? ["-v"] : [])]);
    if (result.code !== 0) throw new Error(`docker compose down failed:\n${result.stderr || result.stdout}`);
}

/** Removes the backups of a workspace from the Local folder and from every storage server. */
export async function clean(config: LabConfig, write: Write, workspace: string): Promise<void> {
    if (!workspace || workspace.includes("/") || workspace.startsWith(".")) throw new Error(`Not a workspace name: ${workspace}`);
    const local = localBackupDir(config, workspace);
    rmSync(local, { recursive: true, force: true });
    write(`Removed ${local}`);

    const removals: [string, string][] = [
        [STORAGE.ssh.service, `rm -rf ${STORAGE.ssh.home}/backups/${workspace} ${STORAGE.ssh.home}/backups/${workspace}-rsync`],
        [STORAGE.webdav.service, `rm -rf /data/${workspace}`],
        [STORAGE.samba.service, `rm -rf /shares/backups/${workspace}`],
        [STORAGE.ftp.service, `rm -rf ${STORAGE.ftp.home}/${workspace}`],
    ];
    for (const [service, command] of removals) {
        const result = await execIn(config, service, command);
        write(`${result.code === 0 ? "Removed" : "Could not remove"} the folder of ${workspace} on ${service}`);
    }

    const removed = await removeS3Prefix(config.docker.address, `${workspace}/`).catch(() => null);
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
