/**
 * The task a dialog, popover, menu entry or button serves. It decides the color of everything
 * inside that carries one: the head, the filled button, picked cards, switches, checkboxes, radio
 * buttons and the focus ring of fields. Outside a task the switches, checkboxes and radio buttons
 * are a quiet gray and fields keep the gray ring. The rules for picking a tone live under Color in
 * `src/app/dashboard/CLAUDE.md`, the colors in `globals.css`.
 *
 * - `create` adds a new entry (blue)
 * - `edit` changes an entry that exists (violet)
 * - `pick` chooses an entry that exists, like a login or a folder (turquoise)
 * - `filter` narrows what a list shows, like the filters of a table (fuchsia)
 * - `warning` warns before going on, or reports what failed (amber)
 * - `destructive` loses something, like deleting (red)
 * - `success` reports that all is well, never on an action (green)
 * - `neutral` is everything else, like settings, pages and menus
 */
export type Tone = "neutral" | "create" | "edit" | "pick" | "filter" | "warning" | "destructive" | "success";

/**
 * A menu entry with a tone looks like a picked card while it is highlighted: a frame and a light
 * tint in the color of the dialog it opens, and its icon in that color. A neutral entry gets the
 * same frame in gray. Shared by the items of the context menu and the dropdown menu.
 */
export const TONED_MENU_ITEM =
    "border border-transparent focus:border-tone/50 focus:bg-tone/5 dark:focus:bg-tone/10 [&_svg:not([class*='text-'])]:text-tone " +
    "data-[tone=neutral]:focus:border-border data-[tone=neutral]:focus:bg-accent data-[tone=neutral]:[&_svg:not([class*='text-'])]:text-muted-foreground";

/** The attribute that hands a tone to an element and everything inside it. */
export function toneAttribute(tone: Tone | undefined): { "data-tone"?: Tone } {
    return tone ? { "data-tone": tone } : {};
}
