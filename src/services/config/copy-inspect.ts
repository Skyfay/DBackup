import { promises as fs } from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { ValidationError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { AppConfigurationBackup, RestorePreview } from "@/lib/types/config-backup";
import { openCopy, readCopyKeys, type CopyKeys } from "./database-copy";

const log = logger.child({ service: "ConfigRestore" });

const SQLITE_HEADER = "SQLite format 3\u0000";
const TEMPLATE_TABLES = ["RetentionPolicy", "NamingTemplate", "SchedulePreset", "NotificationTemplate", "ExcludePatternPreset"];

/** Whether a decrypted configuration backup is a copy of the database rather than a file of an older version. */
export async function isDatabaseCopy(file: string): Promise<boolean> {
    const handle = await fs.open(file, "r");
    try {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(16), 0, 16, 0);
        return bytesRead === 16 && buffer.toString("latin1") === SQLITE_HEADER;
    } finally {
        await handle.close();
    }
}

/** The migrations this DBackup knows, null when the folder cannot be read. */
async function knownMigrations(): Promise<Set<string> | null> {
    try {
        const entries = await fs.readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
        return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    } catch {
        return null;
    }
}

async function countRows(copy: PrismaClient, table: string): Promise<number> {
    try {
        const rows = await copy.$queryRawUnsafe<{ n: bigint | number }[]>(`SELECT COUNT(*) AS n FROM "${table}"`);
        return Number(rows[0]?.n ?? 0);
    } catch {
        return 0;
    }
}

/** Whether the secrets of a copy without its keys open with the ENCRYPTION_KEY of this DBackup. */
async function opensWithThisKey(copy: PrismaClient): Promise<boolean> {
    const rows = await copy.$queryRawUnsafe<{ secretKey: string }[]>(`SELECT "secretKey" FROM "EncryptionProfile" LIMIT 1`).catch(() => []);
    if (rows.length === 0) return true;
    try {
        decrypt(rows[0].secretKey);
        return true;
    } catch {
        return false;
    }
}

export interface InspectedCopy {
    preview: RestorePreview;
    keys: CopyKeys | null;
}

/**
 * Checks that a file is a copy of a DBackup database this version can take, and says what it
 * holds. Refuses a damaged file, one of a newer version, and one whose secrets nobody here can read.
 */
export async function inspectDatabaseCopy(file: string): Promise<InspectedCopy> {
    const copy = openCopy(file);
    try {
        const integrity = await copy.$queryRawUnsafe<Record<string, unknown>[]>("PRAGMA integrity_check").catch(() => []);
        if (Object.values(integrity[0] ?? {})[0] !== "ok") throw new ValidationError("The file is damaged, it is no readable database.");

        const applied = await copy.$queryRawUnsafe<{ migration_name: string }[]>(
            `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
        ).catch(() => null);
        if (!applied) throw new ValidationError("The file is a database, but not one of DBackup.");

        const keys = await readCopyKeys(copy);
        const known = await knownMigrations();
        if (!known) log.warn("The migrations of this DBackup could not be read, so the version of the backup is not checked");
        if (known && applied.some((migration) => !known.has(migration.migration_name))) {
            throw new ValidationError(`The backup comes from a newer DBackup${keys?.version ? `, v${keys.version}` : ""}. Update this one first, then restore it.`);
        }
        if (!keys && !(await opensWithThisKey(copy))) {
            throw new ValidationError("The database belongs to a DBackup with another ENCRYPTION_KEY and holds no copy of it. Start this DBackup with that key, then restore it.");
        }

        const templates = await Promise.all(TEMPLATE_TABLES.map((table) => countRows(copy, table)));
        return {
            keys,
            preview: {
                kind: "database",
                version: keys?.version || null,
                createdAt: keys?.createdAt || null,
                counts: {
                    connections: await countRows(copy, "AdapterConfig"),
                    jobs: await countRows(copy, "Job"),
                    templates: templates.reduce((sum, count) => sum + count, 0),
                    users: await countRows(copy, "User"),
                    runs: await countRows(copy, "Execution"),
                },
                otherKeys: keys ? keys.encryptionKey !== process.env.ENCRYPTION_KEY || keys.authSecret !== process.env.BETTER_AUTH_SECRET : false,
            },
        };
    } finally {
        await copy.$disconnect();
    }
}

/** What a file of an older version holds, in the same words. Its import encrypts the secrets again anyway. */
export function previewOfJson(data: AppConfigurationBackup): RestorePreview {
    return {
        kind: "json",
        version: data.metadata?.version ?? null,
        createdAt: data.metadata?.exportedAt ?? null,
        counts: {
            connections: data.adapters?.length ?? 0,
            jobs: data.jobs?.length ?? 0,
            templates: 0,
            users: data.users?.length ?? 0,
            runs: data.statistics?.executions?.length ?? 0,
        },
        otherKeys: false,
    };
}
