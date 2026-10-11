/**
 * The connections of the dev lab: a source for every database service of the profile, a few of
 * them once more in SSH mode through the SSH host, every storage server as a destination with a
 * folder of this workspace, and a channel for every notification receiver.
 */

import path from "path";
import type { LabConfig } from "../config";
import { DATABASE_LOGINS, ENGINE_NAMES, FIREBIRD_DATABASE, INNER_PORTS, MSSQL_BACKUP_DIR_REMOTE, NOTIFY, STORAGE, databasesOf, sourceName, type DatabaseService, type Engine } from "../catalog";
import { ensureConnection, ensureCredential, type ConnectionSpec } from "./records";
import { localBackupDir, localMssqlBackupDir } from "../folders";
import { ensureFilesFolder, ensureFolder, ensureGotifyToken, ensureLocalSqlite, ensureS3Bucket, ensureStorageFolders } from "./setup";

export interface SeededConnections {
    sources: Map<string, string>;
    destinations: Map<string, string>;
    channels: Map<string, string>;
    log: string[];
}

/** The sources that also get a twin in SSH mode, through the SSH host of the storage part. */
const SSH_TWINS = ["mysql-57", "mariadb-104", "postgres-12", "redis-6"];

function databaseConfig(database: DatabaseService, address: string, port: number, mssqlDir: string): Record<string, unknown> {
    const base = { host: address, port, connectionMode: "direct" };
    switch (database.engine) {
        case "mysql":
        case "mariadb":
            // The lab servers use certificates they signed themselves.
            return { ...base, disableSsl: true };
        case "mongodb":
            return { ...base, authenticationDatabase: "admin" };
        case "mssql":
            return { ...base, encrypt: true, trustServerCertificate: true, backupPath: mssqlDir, fileTransferMode: "local", localBackupPath: mssqlDir };
        case "redis":
        case "valkey":
            return { ...base, mode: "standalone", database: 0 };
        case "firebird":
            return { ...base, databases: [FIREBIRD_DATABASE] };
        default:
            return base;
    }
}

export async function seedConnections(config: LabConfig, workspace: string): Promise<SeededConnections> {
    const sources = new Map<string, string>();
    const destinations = new Map<string, string>();
    const channels = new Map<string, string>();
    const log: string[] = [];
    const note = async (spec: ConnectionSpec, into: Map<string, string>, key: string) => {
        const result = await ensureConnection(spec);
        into.set(key, result.id);
        log.push(`${result.created ? "created" : "updated"} ${spec.type} ${spec.name}`);
    };

    const databasesHost = config.place.databases;
    const storageHost = config.place.storage;
    const notifyHost = config.place.notify;
    const databasesHere = databasesHost.docker === "default";

    // ── Credential profiles ────────────────────────────────
    const logins = new Map<string, string>();
    for (const [engine, login] of Object.entries(DATABASE_LOGINS) as [Engine, { username: string; password: string }][]) {
        logins.set(engine, await ensureCredential(`Lab ${ENGINE_NAMES[engine]} login`, "USERNAME_PASSWORD", login));
    }
    const sshLogin = await ensureCredential("Lab SSH host", "SSH_KEY", { username: STORAGE.ssh.username, authType: "password", password: STORAGE.ssh.password });

    // SQL Server writes its backups into a folder of the Docker host. On this machine DBackup
    // reads the folder, on a remote host it fetches the files over SSH with the login of the host.
    const hostSsh = databasesHost.ssh;
    const hostLogin = !databasesHere && hostSsh
        ? await ensureCredential(`Lab ${databasesHost.name} SSH`, "SSH_KEY", { username: hostSsh.user, authType: "password", password: hostSsh.password })
        : null;

    // ── Database sources ───────────────────────────────────
    for (const database of databasesOf(config.profile)) {
        let sourceConfig = databaseConfig(database, databasesHost.address, database.port, localMssqlBackupDir(config));
        let sshCredentialId: string | null = null;
        if (database.engine === "mssql" && !databasesHere) {
            if (!hostSsh || !hostLogin) {
                log.push(`skipped ${sourceName(database)}, SQL Server on ${databasesHost.name} needs "ssh" in the config of that host`);
                continue;
            }
            sourceConfig = {
                ...sourceConfig,
                backupPath: MSSQL_BACKUP_DIR_REMOTE,
                fileTransferMode: "ssh",
                localBackupPath: undefined,
                sshHost: databasesHost.address,
                sshPort: hostSsh.port,
            };
            sshCredentialId = hostLogin;
        }
        await note({
            name: sourceName(database),
            type: "database",
            adapterId: database.engine,
            config: sourceConfig,
            primaryCredentialId: logins.get(database.engine),
            sshCredentialId,
        }, sources, database.service);
    }

    // The SSH host reaches the databases by service name when both run on the same host.
    const sameHost = databasesHost.name === storageHost.name;
    for (const database of databasesOf(config.profile).filter((entry) => SSH_TWINS.includes(entry.service))) {
        const target = sameHost ? database.service : databasesHost.address;
        const port = sameHost ? INNER_PORTS[database.engine] : database.port;
        await note({
            name: sourceName(database, " (SSH)"),
            type: "database",
            adapterId: database.engine,
            config: {
                ...databaseConfig(database, target, port, ""),
                connectionMode: "ssh",
                sshHost: storageHost.address,
                sshPort: STORAGE.ssh.port,
            },
            primaryCredentialId: logins.get(database.engine),
            sshCredentialId: sshLogin,
        }, sources, `${database.service}-ssh`);
    }

    // ── Native hosts, the databases of a plain server over its OpenSSH ──
    for (const host of Object.values(config.hosts)) {
        if (!host.native) continue;
        const login = host.native.ssh;
        const sshCredentialId = await ensureCredential(`Lab ${host.name} SSH`, "SSH_KEY", { username: login.user, authType: "password", password: login.password });
        const databaseLogin = await ensureCredential(`Lab ${host.name} databases`, "USERNAME_PASSWORD", { username: login.user, password: login.password });
        const redisLogin = await ensureCredential(`Lab ${host.name} Redis`, "USERNAME_PASSWORD", { username: "default", password: login.password });
        const overSsh = { connectionMode: "ssh", sshHost: host.address, sshPort: login.port };
        const natives: [string, string, Record<string, unknown>, string | null][] = [
            // The addresses are those of the databases as the server itself sees them.
            ["postgres", "PostgreSQL", { host: "127.0.0.1", port: 5432 }, databaseLogin],
            // localhost makes the MySQL client take the socket, the login exists for localhost only.
            ["mysql", "MySQL", { host: "localhost", port: 3306 }, databaseLogin],
            ["mongodb", "MongoDB", { host: "127.0.0.1", port: 27017, authenticationDatabase: "admin" }, databaseLogin],
            ["redis", "Redis", { host: "127.0.0.1", port: 6379, mode: "standalone", database: 0 }, redisLogin],
        ];
        for (const [adapterId, label, settings, primaryCredentialId] of natives) {
            await note({
                name: `Lab ${host.name} ${label}`,
                type: "database",
                adapterId,
                config: { ...settings, ...overSsh },
                primaryCredentialId,
                sshCredentialId,
            }, sources, `${host.name}-${adapterId}`);
        }
        await note({
            name: `Lab ${host.name} SQLite`,
            type: "database",
            adapterId: "sqlite",
            config: { mode: "ssh", path: `/home/${login.user}/shop.db`, host: host.address, port: login.port },
            sshCredentialId,
        }, sources, `${host.name}-sqlite`);
    }

    await note({
        name: "Lab SQLite",
        type: "database",
        adapterId: "sqlite",
        config: { mode: "local", path: await ensureLocalSqlite(path.join(config.storageRoot, "lab", "sqlite", "shop.db")) },
    }, sources, "sqlite");
    await note({
        name: "Lab SQLite (SSH)",
        type: "database",
        adapterId: "sqlite",
        config: { mode: "ssh", path: `${STORAGE.ssh.home}/shop.db`, host: storageHost.address, port: STORAGE.ssh.port },
        sshCredentialId: sshLogin,
    }, sources, "sqlite-ssh");

    await note({
        name: "Lab Files",
        type: "storage",
        adapterId: "local-filesystem",
        config: { basePath: ensureFilesFolder(path.join(config.storageRoot, "lab", "files")) },
        storageRole: "SOURCE",
    }, sources, "files");

    // ── Destinations, a folder of this workspace on each ───
    const storageAddress = storageHost.address;
    await note({
        name: "Lab Local",
        type: "storage",
        adapterId: "local-filesystem",
        config: { basePath: ensureFolder(localBackupDir(config, workspace)) },
    }, destinations, "local");

    await ensureS3Bucket(storageAddress).catch(() => log.push("S3 did not answer, its bucket is made by the next lab:seed after lab:up"));
    await ensureStorageFolders(config, workspace).catch(() => log.push("The storage servers did not answer, their folders are made by the next lab:seed after lab:up"));
    await note({
        name: "Lab S3",
        type: "storage",
        adapterId: "s3-generic",
        config: { endpoint: `http://${storageAddress}:${STORAGE.s3.port}`, region: "us-east-1", bucket: STORAGE.s3.bucket, forcePathStyle: true, pathPrefix: workspace },
        primaryCredentialId: await ensureCredential("Lab S3", "ACCESS_KEY", { accessKeyId: STORAGE.s3.accessKey, secretAccessKey: STORAGE.s3.secretKey }),
    }, destinations, "s3");

    await note({
        name: "Lab SFTP",
        type: "storage",
        adapterId: "sftp",
        config: { host: storageAddress, port: STORAGE.ssh.port, pathPrefix: `${STORAGE.ssh.home}/backups/${workspace}` },
        primaryCredentialId: sshLogin,
    }, destinations, "sftp");

    await note({
        name: "Lab Rsync",
        type: "storage",
        adapterId: "rsync",
        config: { host: storageAddress, port: STORAGE.ssh.port, pathPrefix: `${STORAGE.ssh.home}/backups/${workspace}-rsync` },
        primaryCredentialId: sshLogin,
    }, destinations, "rsync");

    await note({
        name: "Lab WebDAV",
        type: "storage",
        adapterId: "webdav",
        config: { url: `http://${storageAddress}:${STORAGE.webdav.port}/`, pathPrefix: workspace },
        primaryCredentialId: await ensureCredential("Lab WebDAV", "USERNAME_PASSWORD", { username: STORAGE.webdav.username, password: STORAGE.webdav.password }),
    }, destinations, "webdav");

    await note({
        name: "Lab SMB",
        type: "storage",
        adapterId: "smb",
        config: { address: `//${storageAddress}/${STORAGE.samba.share}`, maxProtocol: "SMB3", pathPrefix: workspace },
        primaryCredentialId: await ensureCredential("Lab SMB", "USERNAME_PASSWORD", { username: STORAGE.samba.username, password: STORAGE.samba.password }),
    }, destinations, "smb");

    await note({
        name: "Lab FTP",
        type: "storage",
        adapterId: "ftp",
        config: { host: storageAddress, port: STORAGE.ftp.port, tls: false, pathPrefix: `${STORAGE.ftp.home}/${workspace}` },
        primaryCredentialId: await ensureCredential("Lab FTP", "USERNAME_PASSWORD", { username: STORAGE.ftp.username, password: STORAGE.ftp.password }),
    }, destinations, "ftp");

    // ── Notification channels ──────────────────────────────
    const notifyAddress = notifyHost.address;
    await note({
        name: "Lab Mail",
        type: "notification",
        adapterId: "email",
        config: { host: notifyAddress, port: NOTIFY.mailpit.smtpPort, secure: "none", from: "dbackup-lab@dbackup.lab", to: [config.admin.email] },
        primaryCredentialId: await ensureCredential("Lab Mail", "SMTP", { user: "lab", password: "lab-password" }),
    }, channels, "mail");

    await note({
        name: "Lab ntfy",
        type: "notification",
        adapterId: "ntfy",
        config: { serverUrl: `http://${notifyAddress}:${NOTIFY.ntfy.port}`, topic: `dbackup-${workspace}`, priority: 3 },
        primaryCredentialId: await ensureCredential("Lab ntfy", "TOKEN", { token: "lab-ntfy-has-no-login" }),
    }, channels, "ntfy");

    // Gotify hands out the token of an application only while it runs.
    const gotifyToken = await ensureGotifyToken(notifyAddress, workspace).catch(() => null);
    if (gotifyToken) {
        await note({
            name: "Lab Gotify",
            type: "notification",
            adapterId: "gotify",
            config: { serverUrl: `http://${notifyAddress}:${NOTIFY.gotify.port}`, priority: 5 },
            primaryCredentialId: await ensureCredential("Lab Gotify", "TOKEN", { token: gotifyToken }),
        }, channels, "gotify");
    } else {
        log.push("Gotify did not answer, its channel is made by the next lab:seed after lab:up");
    }

    await note({
        name: "Lab Webhook",
        type: "notification",
        adapterId: "generic-webhook",
        config: { method: "POST", contentType: "application/json" },
        primaryCredentialId: await ensureCredential("Lab Webhook", "WEBHOOK", { url: `http://${notifyAddress}:${NOTIFY.webhook.port}/${workspace}` }),
    }, channels, "webhook");

    return { sources, destinations, channels, log };
}
