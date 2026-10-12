/**
 * The sources of the lab: one for every database service of the profile, a few of them once more
 * in SSH mode through the SSH host, every database of the native servers, SQLite here and in the
 * SSH host, and a folder of files. What a source of an engine looks like is in its engine file.
 */

import path from "path";
import { isThisMachine, type LabConfig } from "../config";
import { STORAGE, databasesOf, sourceName } from "../catalog";
import { ENGINES, engineOf } from "../engines";
import { ensureCredential, type ConnectionSpec } from "./records";
import { ensureFilesFolder, ensureLocalSqlite } from "./setup";

export type Note = (spec: ConnectionSpec, key: string) => Promise<void>;

/** The sources that also get a twin in SSH mode, through the SSH host, which reaches them by service name. */
const SSH_TWINS = ["mysql-57", "mariadb-104", "postgres-12", "redis-6"];

/** The credential of the SSH host, which the twins, SQLite over SSH, SFTP and rsync log in with. */
export function ensureSshHostLogin(): Promise<string> {
    return ensureCredential("Lab SSH host", "SSH_KEY", { username: STORAGE.ssh.username, authType: "password", password: STORAGE.ssh.password });
}

export async function seedSources(config: LabConfig, note: Note, log: string[]): Promise<void> {
    const address = config.docker.address;
    const logins = new Map<string, string>();
    for (const spec of ENGINES) logins.set(spec.id, await ensureCredential(`Lab ${spec.name} login`, "USERNAME_PASSWORD", spec.login));
    const sshHost = await ensureSshHostLogin();

    // SQL Server on a remote Docker host writes its backups there, DBackup fetches them over SSH.
    const dockerSsh = config.docker.ssh;
    const dockerLogin = !isThisMachine(config.docker) && dockerSsh
        ? await ensureCredential("Lab Docker host SSH", "SSH_KEY", { username: dockerSsh.user, authType: "password", password: dockerSsh.password })
        : null;

    for (const database of databasesOf(config.profile)) {
        const spec = engineOf(database.engine);
        const sourceConfig = spec.source({ host: address, port: database.port }, config);
        const needsDockerLogin = sourceConfig.fileTransferMode === "ssh";
        if (needsDockerLogin && !dockerLogin) {
            log.push(`skipped ${sourceName(database)}, SQL Server on a remote Docker host needs "ssh" under "docker" in the config`);
            continue;
        }
        await note({
            name: sourceName(database),
            type: "database",
            adapterId: spec.id,
            config: sourceConfig,
            primaryCredentialId: logins.get(spec.id),
            sshCredentialId: needsDockerLogin ? dockerLogin : null,
        }, database.service);
    }

    for (const database of databasesOf(config.profile).filter((entry) => SSH_TWINS.includes(entry.service))) {
        const spec = engineOf(database.engine);
        await note({
            name: sourceName(database, " (SSH)"),
            type: "database",
            adapterId: spec.id,
            config: { ...spec.source({ host: database.service, port: spec.innerPort }, config), connectionMode: "ssh", sshHost: address, sshPort: STORAGE.ssh.port },
            primaryCredentialId: logins.get(spec.id),
            sshCredentialId: sshHost,
        }, `${database.service}-ssh`);
    }

    // ── Native servers, their databases over their OpenSSH ──
    for (const host of config.natives) {
        const login = host.login;
        const sshCredentialId = await ensureCredential(`Lab ${host.name} SSH`, "SSH_KEY", { username: login.user, authType: "password", password: login.password });
        const databaseLogin = await ensureCredential(`Lab ${host.name} databases`, "USERNAME_PASSWORD", { username: login.user, password: login.password });
        // Redis knows only its default user, with the password of the login.
        const redisLogin = await ensureCredential(`Lab ${host.name} Redis`, "USERNAME_PASSWORD", { username: "default", password: login.password });
        for (const spec of ENGINES.filter((candidate) => candidate.native)) {
            await note({
                name: `Lab ${host.name} ${spec.name}`,
                type: "database",
                adapterId: spec.id,
                // The address is the one of the database as the server itself sees it.
                config: { ...spec.source({ host: spec.native!.host, port: spec.innerPort }, config), connectionMode: "ssh", sshHost: host.address, sshPort: login.port },
                primaryCredentialId: spec.id === "redis" ? redisLogin : databaseLogin,
                sshCredentialId,
            }, `${host.name}-${spec.id}`);
        }
        await note({
            name: `Lab ${host.name} SQLite`,
            type: "database",
            adapterId: "sqlite",
            config: { mode: "ssh", path: `/home/${login.user}/shop.db`, host: host.address, port: login.port },
            sshCredentialId,
        }, `${host.name}-sqlite`);
    }

    await note({
        name: "Lab SQLite",
        type: "database",
        adapterId: "sqlite",
        config: { mode: "local", path: await ensureLocalSqlite(path.join(config.storageRoot, "lab", "sqlite", "shop.db")) },
    }, "sqlite");
    await note({
        name: "Lab SQLite (SSH)",
        type: "database",
        adapterId: "sqlite",
        config: { mode: "ssh", path: `${STORAGE.ssh.home}/shop.db`, host: address, port: STORAGE.ssh.port },
        sshCredentialId: sshHost,
    }, "sqlite-ssh");

    await note({
        name: "Lab Files",
        type: "storage",
        adapterId: "local-filesystem",
        config: { basePath: ensureFilesFolder(path.join(config.storageRoot, "lab", "files")) },
        storageRole: "SOURCE",
    }, "files");
}
