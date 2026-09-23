# Dashboard pages and the UI redesign

Rules for every page under `src/app/dashboard/` and the components it renders. This guide is the visual language. The mechanics (ScrollArea, dialogs, forms, tables, dates, logging) stay in [components/CLAUDE.md](../../components/CLAUDE.md), and both apply.

## Status

The UI is redesigned page by page. Shadcn stays, the new look comes from tokens and class choices, not from replacing primitives.

| Done | Where |
| :--- | :--- |
| Sidebar and header | `src/components/layout/`, `src/components/ui/sidebar.tsx` |
| Overview | `src/app/dashboard/(overview)/`, widgets in `src/components/dashboard/widgets/` |
| Storage history dialog | `src/components/dashboard/widgets/storage-history-modal.tsx` |
| Connections, lists and details | `src/app/dashboard/connections/`, `src/components/adapter/connection-*.tsx`. The add and edit dialogs still have the old look. |
| Confirmations and bulk results | `src/components/ui/confirm-dialog.tsx`, `bulk-confirm-dialog.tsx`, `bulk-result-dialog.tsx`, used by every table |

Every other page still has the old look. Do not copy patterns from it, copy them from the Overview widgets. Add a row here when a page is done.

## Page layout

- `layout.tsx` already pads the content (`p-4 md:p-6`) on the `bg-page` canvas. A page adds no outer padding and no background.
- The header bar names the page in its breadcrumb, which is why the Overview's `<h1>` is `sr-only`.
- Sections stack with `space-y-4 md:space-y-6`, grids use `gap-4 md:gap-6`.
- Every grid or flex child that holds text gets `min-w-0`. Without it a long name pushes the page wider than a phone.
- A route-level `loading.tsx` shows a Skeleton shaped like the page. When it must not apply to sibling routes, the page moves into a route group, like `(overview)`.
- A row of tabs that can be wider than a phone becomes a `Select` below `md` and stays tabs above it, both hidden by CSS so neither pops in after loading. See `connections-tabs.tsx`. Tabs that do fit on a phone but not on a tablet sit in `<ScrollArea horizontal>` instead, so they scroll sideways rather than widening the page.
- A layout that differs between phone and desktop waits for `useIsMobileState()`, which is undefined until the screen is measured, and shows its skeleton meanwhile. Rendering the desktop version first makes a phone flash it.

## Cards

```tsx
<div className="min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5">
    <div className="flex items-start justify-between gap-3">
        <div>
            <h2 className="font-semibold">Storage by destination</h2>
            <p className="text-sm text-muted-foreground">5.3 GB in 3 destinations</p>
        </div>
        {/* one control, link or timestamp */}
    </div>
    <div className="mt-4">{/* body */}</div>
</div>
```

- Every panel is `rounded-xl border bg-card shadow-sm`. `bg-page` is the canvas, `bg-card` the surface on it.
- A card header has the title, at most one muted line of context, and at most one control on the right.
- Titles use sentence case: "Storage by destination", not "Storage By Destination".

## Numbers and text

- Numbers use the Geist sans font with `tabular-nums`. `font-mono` is for code, hashes and log output, never for values or labels.
- A headline value is `text-2xl font-semibold tracking-tight tabular-nums md:text-3xl`, with the unit split off in `text-sm text-muted-foreground` via `formatBytes(x, 1).split(" ")`. See `kpi-cards.tsx`.
- A change always carries its sign, `+` or `-`. A size change stays `text-muted-foreground`. Only a change that is good or bad in itself, like the success rate, gets `text-success` or `text-destructive`.
- Secondary counts go into a strip: `grid gap-px overflow-hidden rounded-xl border bg-border` with `bg-card` cells, so the 1px gaps draw the dividers. See `stats-strip.tsx`.
- Relative times use `RelativeTime` from `widgets/relative-time.tsx`, absolute ones `DateDisplay`.
- UI text follows the doc typography: no em or en dashes. Short facts are joined with a middle dot, like "Storage history · last scanned 5 minutes ago".

## Color

- Status tokens: `success` for completed, `destructive` for failed, `warning` for partial runs and conflicts, `info` for running.
- A dialog or a row menu carries the colour of what it does: `destructive` for deleting, `warning` for a report of what failed, `info` for changing and adding, neutral for everything else. Green stays with the status of a thing, never with an action. Use them as text, as tints like `border-destructive/30 bg-destructive/5`, and as icon tiles like `bg-success/12 text-success`.
- Everything that is not a status stays neutral. Sizes, counts, share bars and chart lines use `foreground` or `muted-foreground` shades, like `bg-foreground/80` for a share bar.
- Charts take their colors from the same tokens (`var(--success)`) through the `ChartConfig`, never from hex values or the `--chart-*` palette.

## Controls

- A range or view switch is a segmented `Tabs`, not a `Select`: `<TabsList className="h-8">` with `<TabsTrigger className="px-2.5 text-xs">` and short labels like `30d` or `12h`. See `activity-panel.tsx`.
- Switching a range does not load again. Load the longest range once and cut the shorter ones in the browser, like `upcoming-runs.tsx` and `storage-history-modal.tsx`.
- Buttons in a card header or a banner are `size="sm"` and `outline`, unless one is the single primary action. On phones they go full width with `w-full sm:w-auto` or `flex-1 sm:flex-none`.
- An icon button inside a row is `variant="ghost"` with `size-8` and an `aria-label`.

## Lists and rows

- A clickable row is a stretched link. The `Link` gets `after:absolute after:inset-0` inside a `relative` row, and a button in the row sits above it with `relative z-10`. A button inside a link is invalid HTML. See `jobs-list.tsx`.
- Rows highlight with `hover:bg-muted/50`, and with `has-[a:focus-visible]:bg-muted/50` for keyboard focus.
- A row button that only matters on hover is hidden from `md` up until the row is hovered or the button focused (`md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100`). Below `md` it always shows, since a phone has no hover.
- A table whose columns the user picks gets `columnLayout={useTableLayout(tableId, saved)}` on its DataTable. Columns take `meta.pin`, `meta.defaultHidden` and `meta.filterOnly`, see `connection-columns.tsx`.
- A row that opens details takes `onRowClick`, and its name cell gets a button as the keyboard way in. `isPlainClick` keeps clicks on controls and popovers inside the row from opening it.
- A right click on a row opens `renderRowMenu`, which returns a `ContextMenuContent`. Its head is tinted `info` and names the row, the row stays marked while it is open, and a long press opens it on a phone. When the row is one of several selected, the menu gets the bulk context and offers the actions of the whole selection instead. The button at the end of the row stays, as the way in for keyboard and touch. See `connection-context-menu.tsx`.
- A list that also offers cards passes `view="cards"` and `renderCard` to DataTable. A card renders the row's own cells, so the Columns menu decides what it shows, see `connection-card.tsx`. Bulk actions stay in the table view.
- A list beside the details of the picked record passes `view="split"` and `renderSplit`, which gets every filtered row at once. See `connection-split-view.tsx`, whose details are the same component the side panel shows.

## Banners

- `status-banner.tsx` is the pattern: tinted card, a `w-1` colored bar on the left edge, a `size-9` icon tile, a title with one line under it, actions on the right.
- A banner about problems starts collapsed to those two lines. Details and per-item actions sit behind "Show details", so a bad day does not push the page down.

## Charts

- `ChartContainer` gets a fixed height and full width, like `aspect-auto h-44 w-full md:h-52`. Axis text is `fontSize={11}` with `tabular-nums`, without axis lines or tick lines, and the grid is horizontal only.
- Time on the x axis is either a real time axis (`type="number" scale="time"`) or exactly one category per day. One category per raw measurement repeats dates and warps time.
- Axis dates use the compact literal `"MMM d"`, tooltips the user's format (`"P"` or `"Pp"`).
- Byte axes step in round units, see `byteTicks` in `storage-history-data.ts`.
- Lines are `type="linear"`. A smoothed curve turns a sudden jump into a ramp that never happened.
- Stacked bars follow `activity-chart.tsx`, where `stroke="var(--card)"` draws the gaps between segments.

## Dialogs

- The same language applies inside a dialog. The title names the object ("Local"), the description says what the dialog shows, and a headline number follows the card style. See `storage-history-modal.tsx`.
- A confirmation is a `ConfirmDialog` from `ui/confirm-dialog.tsx`. Its head is tinted in the tone of the action like the banners, red for destructive and amber for a report of failures, and holds an icon tile, the title and a short note such as "Cannot be undone". The dialog sits on `bg-card`, so it stands out from the dimmed page in dark mode, and its buttons sit on a `bg-page/60` strip. See `connection-delete-dialog.tsx`.
- A destructive confirm button is tinted rather than filled and names what it does, like "Delete 7 connections". It keeps the dialog open with a spinner until the request returns.
- A popover that tells how something is doing uses the same tinted `DialogHead`, with the `success` tone when all is well. It sits on `bg-raised`, which in dark mode is one step lighter than the cards, so it stands out from the table under it. See `connection-health-popover.tsx`.
- The records a dialog is about go into a `DialogItemList` with icon, name and a short fact. Rows a bulk action leaves out come from its `ineligible` check and get a list of their own under "Will not be deleted" with the reason, so the confirmation says beforehand what happens. See `deleteBlocker` in `connection-bulk-actions.ts`.

## Live data

- A page with live state polls with `DashboardRefresh`: every 3 seconds while a job runs, every 30 seconds otherwise, never in a hidden tab.
- Whatever a poll recomputes must be cheap. The Overview caches its aggregates in `src/services/dashboard/cache.ts`, and a finished backup clears that cache.

## Checklist for a redesigned page

1. Panels are `rounded-xl border bg-card shadow-sm` on the `bg-page` canvas.
2. Numbers use Geist with `tabular-nums`, and no UI text uses `font-mono`.
3. Status colors come from the tokens, everything else is neutral.
4. Range switches are segmented Tabs and switch without loading again.
5. Loading states are Skeletons shaped like the content.
6. The page works at 375px width and in both themes.
7. The page is added to the Status table above.
