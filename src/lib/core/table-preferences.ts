import { z } from "zod";

/** Row heights a table offers. */
export const TABLE_DENSITIES = ["comfortable", "compact"] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

/** Rows per page a table offers. The paged lists of History and the audit log take up to 100. */
export const PAGE_SIZES = [10, 20, 30, 40, 50, 100] as const;
const PageSizeSchema = z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value), "Not a page size a table offers");

/**
 * The layout a user picked for one table.
 *
 * Only lists what the user changed. A column that appears in neither list keeps its default
 * place and visibility, so a column added in a later release still shows up. The row height
 * and the rows per page are left out while the table follows the defaults of the profile.
 */
export const TablePreferencesSchema = z.object({
    /** Movable column ids in the order the user arranged them. */
    order: z.array(z.string().min(1).max(64)).max(64),
    /** Column ids the user switched off. */
    hidden: z.array(z.string().min(1).max(64)).max(64),
    density: z.enum(TABLE_DENSITIES).optional(),
    pageSize: PageSizeSchema.optional(),
});

export type TablePreferences = z.infer<typeof TablePreferencesSchema>;

/** How every table of a user starts, set in the profile. */
export const TableDefaultsSchema = z.object({
    pageSize: PageSizeSchema,
    density: z.enum(TABLE_DENSITIES),
});

export type TableDefaults = z.infer<typeof TableDefaultsSchema>;

/** The defaults of a user who never set any. */
export const TABLE_DEFAULTS: TableDefaults = { pageSize: 20, density: "comfortable" };

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

/** The views every list page has. The Backups page and the Database Explorer add the timeline, the restore page the lines. */
export type ListViewMode = Exclude<ViewMode, "timeline" | "lines">;

/** A saved view for a page without a timeline or lines, which shows the table instead. */
export function listView(view: ViewMode): ListViewMode {
    return view === "timeline" || view === "lines" ? "table" : view;
}
