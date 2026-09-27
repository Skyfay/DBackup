import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import {
    TABLE_DEFAULTS,
    TableDefaultsSchema,
    TablePreferencesSchema,
    ViewModeSchema,
    type TableDefaults,
    type TablePreferences,
    type ViewMode,
} from "@/lib/core/table-preferences";

const log = logger.child({ service: "PreferenceService" });

const TABLE_PREFIX = "table:";
const VIEW_PREFIX = "view:";
/** Outside the table prefix, which any table id could reach. */
const TABLE_DEFAULTS_KEY = "defaults:tables";

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

/**
 * The rows per page and the row height every table of a user starts with. A user who never set
 * them, or whose value no longer validates or can not be read, gets the ones DBackup ships with.
 */
export async function getTableDefaults(userId: string): Promise<TableDefaults> {
    try {
        const row = await prisma.userPreference.findUnique({
            where: { userId_key: { userId, key: TABLE_DEFAULTS_KEY } },
            select: { value: true },
        });
        if (!row) return TABLE_DEFAULTS;
        const parsed = TableDefaultsSchema.safeParse(parseJson(row.value));
        if (parsed.success) return parsed.data;
        log.warn("Ignoring invalid table defaults", { userId });
    } catch (error) {
        log.warn("Could not read the table defaults", { userId }, wrapError(error));
    }
    return TABLE_DEFAULTS;
}

export async function setTableDefaults(userId: string, defaults: TableDefaults): Promise<void> {
    const value = JSON.stringify(TableDefaultsSchema.parse(defaults));
    await prisma.userPreference.upsert({
        where: { userId_key: { userId, key: TABLE_DEFAULTS_KEY } },
        create: { userId, key: TABLE_DEFAULTS_KEY, value },
        update: { value },
    });
}

/** The view a user picked for a list page, null when they never picked one or it can not be read. */
export async function getViewMode(userId: string, pageId: string): Promise<ViewMode | null> {
    try {
        const row = await prisma.userPreference.findUnique({
            where: { userId_key: { userId, key: VIEW_PREFIX + pageId } },
            select: { value: true },
        });
        const parsed = ViewModeSchema.safeParse(row ? parseJson(row.value) : null);
        return parsed.success ? parsed.data : null;
    } catch (error) {
        log.warn("Could not read a saved view", { userId, pageId }, wrapError(error));
        return null;
    }
}

export async function saveViewMode(userId: string, pageId: string, view: ViewMode): Promise<void> {
    const key = VIEW_PREFIX + pageId;
    const value = JSON.stringify(ViewModeSchema.parse(view));
    await prisma.userPreference.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, value },
        update: { value },
    });
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}
