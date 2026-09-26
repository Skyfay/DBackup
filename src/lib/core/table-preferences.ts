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

/** Names a page whose view is saved, like "connections". Same shape as a table id. */
export const PageIdSchema = TableIdSchema;

/**
 * How a list page shows its records. "split" is a list with the details beside it, "timeline" a grid of days above the list,
 * "lines" what goes where drawn as lines, like on the restore page.
 */
export const VIEW_MODES = ["table", "cards", "split", "timeline", "lines"] as const;
export const ViewModeSchema = z.enum(VIEW_MODES);
export type ViewMode = z.infer<typeof ViewModeSchema>;

/** The views every list page has. Only the Storage Explorer adds the timeline, and the restore page the lines. */
export type ListViewMode = Exclude<ViewMode, "timeline" | "lines">;

/** A saved view for a page without a timeline or lines, which shows the table instead. */
export function listView(view: ViewMode): ListViewMode {
    return view === "timeline" || view === "lines" ? "table" : view;
}
