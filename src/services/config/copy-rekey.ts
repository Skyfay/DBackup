/**
 * A copy made by a DBackup with another ENCRYPTION_KEY or BETTER_AUTH_SECRET holds its secrets
 * encrypted with those. They are encrypted again for this DBackup before the copy replaces its
 * database.
 *
 * Every value DBackup encrypts has one form, `iv:authTag:data` in hex, and AES-GCM opens only a
 * value that really is one, so the copy is searched rather than listed: a table a later version
 * adds is covered without a word here. Tables that never hold a secret are skipped for speed.
 */

import type { PrismaClient } from "@prisma/client";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { decryptWithKey, encryptWithKey } from "@/lib/crypto";
import { logger } from "@/lib/logging/logger";
import { DROPPED_TABLES, HISTORY_TABLES, type CopyKeys } from "./database-copy";

const log = logger.child({ service: "ConfigRestore" });

const ENCRYPTED = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/;
const NO_SECRETS = new Set(["_prisma_migrations", "TwoFactor", "DbVersionHistory", "UserPreference", "LoginImage", "Avatar", ...HISTORY_TABLES, ...DROPPED_TABLES]);
const PAGE = 500;

/** One value encrypted again, or as it was when it is no encrypted value. JSON is searched inside. */
export function rekeyValue(value: string, from: Buffer, to: Buffer): string {
    if (ENCRYPTED.test(value)) {
        try {
            return encryptWithKey(decryptWithKey(value, from), to);
        } catch {
            return value;
        }
    }
    if (value[0] !== "{" && value[0] !== "[") return value;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return value;
    }
    let changed = false;
    const walk = (node: unknown): unknown => {
        if (typeof node === "string") {
            // A string may hold JSON of its own, like the config of a connection in Recently deleted.
            const next = rekeyValue(node, from, to);
            if (next !== node) changed = true;
            return next;
        }
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, walk(entry)]));
        return node;
    };
    const next = walk(parsed);
    return changed ? JSON.stringify(next) : value;
}

async function rekeyTables(copy: PrismaClient, from: Buffer, to: Buffer): Promise<number> {
    let rekeyed = 0;
    const tables = (await copy.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`))
        .map((row) => row.name)
        .filter((name) => !NO_SECRETS.has(name));

    for (const table of tables) {
        const columns = (await copy.$queryRawUnsafe<{ name: string; type: string }[]>(`PRAGMA table_info("${table}")`))
            .filter((column) => /TEXT/i.test(column.type))
            .map((column) => column.name);
        if (columns.length === 0) continue;
        const list = columns.map((column) => `"${column}"`).join(", ");

        let after: bigint | number = -1;
        for (;;) {
            const rows = await copy.$queryRawUnsafe<Record<string, unknown>[]>(
                `SELECT rowid AS "__rowid", ${list} FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`,
                after
            );
            if (rows.length === 0) break;
            for (const row of rows) {
                const changes = columns.flatMap((column) => {
                    const value = row[column];
                    if (typeof value !== "string") return [];
                    const next = rekeyValue(value, from, to);
                    return next === value ? [] : [[column, next] as const];
                });
                if (changes.length === 0) continue;
                await copy.$executeRawUnsafe(
                    `UPDATE "${table}" SET ${changes.map(([column]) => `"${column}" = ?`).join(", ")} WHERE rowid = ?`,
                    ...changes.map(([, next]) => next),
                    row.__rowid
                );
                rekeyed += changes.length;
            }
            after = rows[rows.length - 1].__rowid as bigint | number;
        }
    }
    return rekeyed;
}

/** The second factors, which better-auth encrypts with BETTER_AUTH_SECRET. */
async function rekeySecondFactors(copy: PrismaClient, from: string, to: string): Promise<number> {
    let rekeyed = 0;
    for (const factor of await copy.twoFactor.findMany({ select: { id: true, secret: true, backupCodes: true } })) {
        try {
            await copy.twoFactor.update({
                where: { id: factor.id },
                data: {
                    secret: await symmetricEncrypt({ key: to, data: await symmetricDecrypt({ key: from, data: factor.secret }) }),
                    backupCodes: await symmetricEncrypt({ key: to, data: await symmetricDecrypt({ key: from, data: factor.backupCodes }) }),
                },
            });
            rekeyed++;
        } catch {
            // Its user sets the second factor up again, which is no worse than a lost phone.
            log.warn("A second factor of the backup could not be opened", { twoFactorId: factor.id });
        }
    }
    return rekeyed;
}

/**
 * The second factors of deleted users, which Recently deleted keeps in the snapshot of their user.
 * Read raw, since a copy of a version before Recently deleted has no such table.
 */
async function rekeyDeletedSecondFactors(copy: PrismaClient, from: string, to: string): Promise<number> {
    const [table] = await copy.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'DeletedRecord'`);
    if (!table) return 0;
    let rekeyed = 0;
    for (const row of await copy.$queryRawUnsafe<{ id: string; data: string }[]>(`SELECT "id", "data" FROM "DeletedRecord" WHERE "kind" = 'user'`)) {
        try {
            const snapshot = JSON.parse(row.data) as { twoFactor?: { secret: string; backupCodes: string } | null };
            if (!snapshot.twoFactor) continue;
            snapshot.twoFactor.secret = await symmetricEncrypt({ key: to, data: await symmetricDecrypt({ key: from, data: snapshot.twoFactor.secret }) });
            snapshot.twoFactor.backupCodes = await symmetricEncrypt({ key: to, data: await symmetricDecrypt({ key: from, data: snapshot.twoFactor.backupCodes }) });
            await copy.$executeRawUnsafe(`UPDATE "DeletedRecord" SET "data" = ? WHERE "id" = ?`, JSON.stringify(snapshot), row.id);
            rekeyed++;
        } catch {
            // Restored, the user sets the second factor up again, like after a lost phone.
            log.warn("A second factor in Recently deleted could not be opened", { deletedRecordId: row.id });
        }
    }
    return rekeyed;
}

/** Encrypts the secrets of a copy again for this DBackup, when the copy came from one with other keys. */
export async function rekeyCopy(copy: PrismaClient, keys: CopyKeys): Promise<void> {
    const thisKey = process.env.ENCRYPTION_KEY ?? "";
    const thisSecret = process.env.BETTER_AUTH_SECRET ?? "";
    if (keys.encryptionKey && keys.encryptionKey !== thisKey) {
        const values = await rekeyTables(copy, Buffer.from(keys.encryptionKey, "hex"), Buffer.from(thisKey, "hex"));
        log.info("Secrets of the backup encrypted again for this DBackup", { values });
    }
    if (keys.authSecret && keys.authSecret !== thisSecret) {
        const factors = await rekeySecondFactors(copy, keys.authSecret, thisSecret);
        const deleted = await rekeyDeletedSecondFactors(copy, keys.authSecret, thisSecret);
        log.info("Second factors of the backup encrypted again for this DBackup", { factors, deleted });
    }
}
