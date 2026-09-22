import { z } from "zod";

/** Row heights a table offers. */
export const TABLE_DENSITIES = ["comfortable", "compact"] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

/**
 * The layout a user picked for one table.
 *
 * Only lists what the user changed. A column that appears in neither list keeps its default
 * place and visibility, so a column added in a later release still shows up.
 */
export const TablePreferencesSchema = z.object({
    /** Movable column ids in the order the user arranged them. */
    order: z.array(z.string().min(1).max(64)).max(64),
    /** Column ids the user switched off. */
    hidden: z.array(z.string().min(1).max(64)).max(64),
    density: z.enum(TABLE_DENSITIES),
});

export type TablePreferences = z.infer<typeof TablePreferencesSchema>;

/** Names a table across the app, like "connections.databases". */
export const TableIdSchema = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/).max(64);
