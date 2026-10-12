/**
 * The steps the tests share: a source with its logins, a Local destination, a restore whose content
 * the tools of the engine compare with the original, and files made inside DBackup itself.
 */

import { readFileSync } from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { REPO_ROOT } from "../../lab/src/config";
import { execIn } from "../../lab/src/docker";
import { dropIn, fingerprintIn } from "../../lab/src/fingerprints";
import { App, problemOf, type Connection, type Execution } from "./app";
import { lab } from "./environment";
import type { Target } from "./targets";

/** Creates the logins and the source of a target. Returns its id and what it is made of, for Test connection. */
export async function createSource(app: App, target: Target, name: string): Promise<{ id: string; connection: Connection }> {
    const connection: Connection = { adapterId: target.adapterId, config: target.config(lab) };
    if (target.login) connection.primaryCredentialId = await app.credential(`${name} login`, "USERNAME_PASSWORD", target.login);
    if (target.ssh) connection.sshCredentialId = await app.credential(`${name} ssh`, "SSH_KEY", { ...target.ssh, authType: "password" });
    const id = await app.connection({ ...connection, name: `${name} ${target.key}`, type: "database" });
    return { id, connection };
}

/** A Local Filesystem destination in a folder of its own inside DBackup. */
export function localDestination(app: App, name: string): Promise<string> {
    return app.connection({ name: `${name} local`, type: "storage", adapterId: "local-filesystem", config: { basePath: `/data/e2e/${name}/backups` } });
}

/**
 * Restores the database of a target from a backup under the name `suffix` gives it, compares
 * what the tools of the engine read in the original and the copy, and drops the copy again
 * unless E2E_KEEP is set.
 */
export async function expectSameContentAfterRestore(app: App, target: Target, sourceId: string, destinationId: string, backup: Execution, suffix: string): Promise<void> {
    const original = target.database!;
    const copy = original.restoreAs(suffix);
    await dropIn(lab, target.adapterId, target.service, copy.location, target.native);
    try {
        const restored = await app.restore(destinationId, { file: backup.path, targetSourceId: sourceId, databaseMapping: { [original.name]: copy.name } });
        expect(restored.status, problemOf(restored)).toBe("Success");
        const before = await fingerprintIn(lab, target.adapterId, target.service, original.location, target.native);
        const after = await fingerprintIn(lab, target.adapterId, target.service, copy.location, target.native);
        expect(after.split(copy.location).join(original.location)).toBe(before);
    } finally {
        if (!process.env.E2E_KEEP) await dropIn(lab, target.adapterId, target.service, copy.location, target.native);
    }
}

/** Runs a shell command inside DBackup, as root, and gives what it made to the user DBackup runs as. */
export async function inApp(command: string, input?: string): Promise<string> {
    const result = await execIn(lab, "app", command, input, 60_000);
    expect(result.code, `${command}: ${result.stderr || result.stdout}`).toBe(0);
    return result.stdout;
}

/** A SQLite database of the dataset inside DBackup, for a source in local mode. Returns its path. */
export async function sqliteInApp(name: string): Promise<string> {
    const folder = `/data/e2e/${name}/sqlite`;
    const dataset = readFileSync(path.join(REPO_ROOT, "lab", "datasets", "sqlite.sql"), "utf8");
    await inApp(`mkdir -p ${folder} && sqlite3 ${folder}/shop.db && chown -R --reference=/data /data/e2e`, dataset);
    return `${folder}/shop.db`;
}

/** Skips a test whose service did not start on this machine, like MongoDB 8 on a CPU without AVX. Never in CI. */
export function skipWhenUnavailable(service: string): void {
    const unavailable = JSON.parse(process.env.E2E_UNAVAILABLE ?? "{}") as Record<string, string>;
    test.skip(!!unavailable[service], `${service} did not start here: ${unavailable[service]}`);
}
