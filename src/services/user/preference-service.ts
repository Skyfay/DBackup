import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { TablePreferencesSchema, type TablePreferences } from "@/lib/core/table-preferences";

const log = logger.child({ service: "PreferenceService" });

const TABLE_PREFIX = "table:";

/**
 * The saved layouts of several tables, keyed by table id.
 *
 * A layout that no longer passes validation is skipped, so the table falls back to its
 * defaults instead of breaking. A failed read does the same: a layout is a convenience and
 * must never keep a page from loading.
 */
export async function getTablePreferences(userId: string, tableIds: string[]): Promise<Record<string, TablePreferences>> {
    const layouts: Record<string, TablePreferences> = {};
    if (tableIds.length === 0) return layouts;

    try {
        const rows = await prisma.userPreference.findMany({
            where: { userId, key: { in: tableIds.map((id) => TABLE_PREFIX + id) } },
            select: { key: true, value: true },
        });
        for (const row of rows) {
            const parsed = TablePreferencesSchema.safeParse(parseJson(row.value));
            if (parsed.success) {
                layouts[row.key.slice(TABLE_PREFIX.length)] = parsed.data;
            } else {
                log.warn("Ignoring an invalid saved table layout", { key: row.key });
            }
        }
    } catch (error) {
        log.warn("Could not read saved table layouts", { userId }, wrapError(error));
    }
    return layouts;
}

/** Stores the layout of one table for one user, replacing what was there. */
export async function saveTablePreferences(userId: string, tableId: string, preferences: TablePreferences): Promise<void> {
    const key = TABLE_PREFIX + tableId;
    const value = JSON.stringify(TablePreferencesSchema.parse(preferences));
    await prisma.userPreference.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, value },
        update: { value },
    });
}

/** Forgets the layout of one table, so it shows its defaults again. */
export async function resetTablePreferences(userId: string, tableId: string): Promise<void> {
    await prisma.userPreference.deleteMany({ where: { userId, key: TABLE_PREFIX + tableId } });
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}
