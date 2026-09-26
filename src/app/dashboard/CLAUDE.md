# Dashboard pages and the UI redesign

Rules for every page under `src/app/dashboard/` and the components it renders. This guide is the visual language. The mechanics (ScrollArea, dialogs, forms, tables, dates, logging) stay in [components/CLAUDE.md](../../components/CLAUDE.md), and both apply.

## Status

The UI is redesigned page by page. Shadcn stays, the new look comes from tokens and class choices, not from replacing primitives.

| Done | Where |
| :--- | :--- |
| Sidebar and header | `src/components/layout/`, `src/components/ui/sidebar.tsx` |
| Overview | `src/app/dashboard/(overview)/`, widgets in `src/components/dashboard/widgets/` |
| Storage history dialog | `src/components/dashboard/widgets/storage-history-modal.tsx` |
| Connections, lists and details | `src/app/dashboard/connections/`, `src/components/adapter/connection-*.tsx`. The add and edit form is done for every type. |
| Confirmations and bulk results | `src/components/ui/confirm-dialog.tsx`, `bulk-confirm-dialog.tsx`, `bulk-result-dialog.tsx`, used by every table |
| Quick Setup | `src/app/dashboard/setup/`, `src/components/dashboard/setup/` |
| Jobs, list, details and form | `src/app/dashboard/jobs/`, `src/components/dashboard/jobs/`, including the API trigger and clone dialogs. |
| Storage Explorer, both tabs | `src/app/dashboard/storage/storage-client.tsx`, `src/components/dashboard/storage/explorer/`, and the download dialog in `src/components/dashboard/storage/download/` |
| Restore page | `src/app/dashboard/storage/restore/`, `src/components/dashboard/storage/restore/`. The Redis and Valkey guide is `redis-guide.tsx`. The key dialog, the folder picker and the file tree inside it still have the old look. |

Every other page still has the old look. Do not copy patterns from it, copy them from the Overview widgets. Add a row here when a page is done.

## Page layout

- `layout.tsx` already pads the content (`p-4 md:p-6`) on the `bg-page` canvas. A page adds no outer padding and no background.
- The header bar names the page in its breadcrumb, which is why the Overview's `<h1>` is `sr-only`.
- Sections stack with `space-y-4 md:space-y-6`, grids use `gap-4 md:gap-6`.
- Every grid or flex child that holds text gets `min-w-0`. Without it a long name pushes the page wider than a phone.
- A route-level `loading.tsx` shows a Skeleton shaped like the page. When it must not apply to sibling routes, the page moves into a route group, like `(overview)`.
- Tabs at the top of a page switch between lists of different records, like the kinds of connections. Quick filters of one list, like Needs attention on the Jobs page, are `QuickFilter` chips with their counts beside its search, passed as `toolbarExtra` to the `DataTable`. When they would push the toolbar onto a second row, like the states of a backup in the Storage Explorer, they become one more filter named State, whose closed field counts what needs a look, see `backup-filter-columns.tsx`. A page with one list shows one selected tab with its name and count, like Jobs, so its top row reads like the pages with several lists. See `connection-status-filter.tsx` and `job-status-filter.tsx`.
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

- Status tokens: `success` for completed, `destructive` for failed, `warning` for partial runs and conflicts, `info` for running. As a status, blue is a dot, a badge, a tinted row or the newest bar of a chart, never a button or a head.
- Everything a user acts on takes the color of its task, its tone. These are all of them. A new one needs a new kind of task, never a new area of the app, since every extra color is one more meaning to learn and no hue is left that does not look like one of these:

| Tone | Color | Task | Examples |
| :--- | :--- | :--- | :--- |
| `create` | Blue | Adds a new entry | New database, Create job, Clone, the type picker before a form |
| `edit` | Violet | Changes an entry that exists | Edit database, Edit user, Edit template |
| `pick` | Turquoise | Chooses an entry that exists | A saved login, a folder, a file, the databases of a job |
| `filter` | Fuchsia | Narrows what a list shows | The filters of every table |
| `warning` | Amber | Warns before going on, or reports what failed | Save anyway, Restore, the result of a bulk action |
| `destructive` | Red | Loses something | Delete, Remove, Revoke |
| `success` | Green | Reports that all is well | Never on an action |
| `neutral` | Primary | Everything else | Settings, pages, menus, Sign in, Test, Download |

- The tone is set once, where the task starts: `<DialogContent tone="edit">`, `<PopoverContent tone="pick">`, a menu entry's `tone`, or `<Button tone="create">` for New database on a page. Everything inside that carries a color reads it through the `tone` utilities (`bg-tone`, `text-tone`, `border-tone/60`): the `DialogHead`, the filled button, picked cards, switches, checkboxes, radio buttons and the focus ring of fields. A form that adds and edits sets `tone={initialData ? "edit" : "create"}` once and all of it follows, see `connection-form.tsx`. Nothing picks a task color by hand.
- A switch, checkbox, radio button or picked card shows the tone of the dialog it sits in, so the same setting is blue while adding and violet while editing. On a page, in Settings or in any dialog without a task it is the quiet gray `--control-neutral`, not the white or black of a neutral button, so a setting that is on never outshines the page. Fields there keep the gray focus ring. All of it comes from the primitives through `--tone-control`, so no call site sets a checked color of its own.
- Pages are neutral. On a page only the button that opens a toned dialog carries its tone, and a Delete button is `variant="destructive"`. A delete among quiet buttons, like at the end of a table row or in the bar of a selection, is `variant="ghost-destructive"`, red text with a red frame and tint on hover, see `destination-jobs.tsx`. The filled button of a view is its one main action, everything beside it is `outline` or `ghost`.
- A menu entry shows the tone of the dialog it opens: the icon in that color and, while it is highlighted, a frame and a light tint like a picked card. The head of the menu stays neutral. See `connectionActions`.
- The task colors are `--create`, `--edit` and `--pick` in `globals.css`, each with a `-foreground`, so a theme or a user setting changes one in a single place.
- The `info` blue anywhere but a running status or the newest bar of a chart fails the build, and so does a raw `data-tone` attribute (`tests/unit/lint-guards/design-system.test.ts`).
- Use the status colors as text, as tints like `border-destructive/30 bg-destructive/5`, and as icon tiles like `bg-success/12 text-success`.
- Everything that is not a status stays neutral. Sizes, counts, share bars and chart lines use `foreground` or `muted-foreground` shades, like `bg-foreground/80` for a share bar.
- Charts take their colors from the same tokens (`var(--success)`) through the `ChartConfig`, never from hex values or the `--chart-*` palette.

## Controls

- A range or view switch is a segmented `Tabs`, not a `Select`: `<TabsList className="h-8">` with `<TabsTrigger className="px-2.5 text-xs">` and short labels like `30d` or `12h`. See `activity-panel.tsx`.
- Switching a range does not load again. Load the longest range once and cut the shorter ones in the browser, like `upcoming-runs.tsx` and `storage-history-modal.tsx`.
- Buttons in a card header or a banner are `size="sm"` and `outline`, unless one is the single primary action. On phones they go full width with `w-full sm:w-auto` or `flex-1 sm:flex-none`.
- An icon button inside a row is `variant="ghost"` with `size-8` and an `aria-label`.
- The focus ring is 2px of `ring` at half strength plus a `ring` coloured border, quiet enough to sit beside the content. The border carries the contrast, the halo only makes it easier to spot. It shows on keyboard focus on every control and on a click into a text field. A field takes its ring from `--tone-ring`: blue, violet or turquoise in a dialog that adds, edits or picks, the quiet gray everywhere else. A destructive or warning dialog keeps the gray too, since a red or amber border on a field reads as an error.

## Lists and rows

- A clickable row is a stretched link. The `Link` gets `after:absolute after:inset-0` inside a `relative` row, and a button in the row sits above it with `relative z-10`. A button inside a link is invalid HTML. See `jobs-list.tsx`.
- Rows highlight with `hover:bg-muted/50`, and with `has-[a:focus-visible]:bg-muted/50` for keyboard focus.
- A row button that only matters on hover is hidden from `md` up until the row is hovered or the button focused (`md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100`). Below `md` it always shows, since a phone has no hover. A DataTable row is the group `group/row`, so a button in it uses `md:group-hover/row:opacity-100`, see `JobRowActions` in `job-menus.tsx`.
- A table whose columns the user picks gets `columnLayout={useTableLayout(tableId, saved)}` on its DataTable. Columns take `meta.pin`, `meta.defaultHidden` and `meta.filterOnly`, see `connection-columns.tsx`.
- A row that opens details takes `onRowClick`, and its name cell gets a button as the keyboard way in. `isPlainClick` keeps clicks on controls and popovers inside the row from opening it.
- A right click on a row opens `renderRowMenu`, which returns a `ContextMenuContent`. Its head is neutral and names the row, each entry shows the tone of the dialog it opens, the row stays marked while it is open, and a long press opens it on a phone. When the row is one of several selected, the menu gets the bulk context and offers the actions of the whole selection instead. The button at the end of the row stays, as the way in for keyboard and touch. The head and the menu for a selection come from `RowMenuHead` and `SelectionMenu` in `ui/row-menu.tsx`. See `connection-context-menu.tsx` and `job-menus.tsx`.
- The picker that opens before a form is one grouped list with a search, not a grid: `AdapterPickerDialog` in `adapter-picker.tsx`. Its tone is `create` like the form behind it, the headings stick while the list scrolls, and the footer says which step it is.
- A list that also offers cards passes `view="cards"` and `renderCard` to DataTable. A card renders the row's own cells, so the Columns menu decides what it shows, see `connection-card.tsx`. A card may show what the record does instead, like the way of a backup from its source to its destinations in `job-card.tsx`. Bulk actions stay in the table view.
- The views of a list are switched with `ViewSwitch` from `ui/view-switch.tsx`, and the choice is saved per page with `saveViewLayout`. The timeline is a view only where a page names it in `views`, like the Storage Explorer, and the other pages read a saved one with `listView`. A page whose cards only repeat the rows of its table leaves them out of `views`, so only a phone gets them, like the Storage Explorer. A phone always gets the cards and no switch. See `connections-tabs.tsx` and `jobs-client.tsx`.
- A list beside the details of the picked record passes `view="split"` and `renderSplit`, which gets every filtered row at once. See `connection-split-view.tsx`, whose details are the same component the side panel shows.
- Details with more than a side panel holds, like a destination with its history, alerts and jobs, show under the list as wide as the page instead of in a `Sheet`. A click on a row shows them and marks the row with `activeRowId`, a second click or the X hides them, the page scrolls to them, and the pick lives in the address. A list inside them that can grow long, like the jobs at a destination, is a DataTable of its own with its search and filters. See `destinations-view.tsx` and `destination-details.tsx`.
- A timeline above a list filters it. The list stays hidden until a day, a job or a day of a job is clicked, the pick shows as a chip in the toolbar of the list that a click removes, and a row of the list opens the details. The timeline sits in the card of the DataTable as `aboveRows`, with `hideRows` until a pick. See `jobs-timeline.tsx` and `PickChip` in `explorer-controls.tsx`. A timeline of records whose details show under the list, like the destinations, picks a record instead and keeps its rows hidden, see `destinations-timeline.tsx`.
- A timeline of days shows as many days as its width has room for, never a switch of 7, 30 or 90 days. The arrows page a screen at a time, the button with the dates opens a `Calendar` to jump to a day, and at today the arrow on the right adds the days the schedules plan, dashed, while today stays in view. See `timeline-nav.tsx`.
- Records that can be looked at from several sides, like backups by job and by destination, are one list with a filter per side, not a tab, a mode or a folder per side. See `backups-list.tsx`.
- A filter that also decides what the rest counts, like the destination filter of the Storage Explorer, gets the rows, the counts beside every filter and the numbers above the list from one pure module, and the DataTable gets `manualFiltering`, so they never disagree. See `backup-filters.ts`.
- A filter whose options fall into kinds, like jobs, deleted jobs and the rest, gives each option a `group` and a `lead`, a `size-4` icon like in a `Select`, so the list shows them under headings. Its `unavailableLabel` names the end of the list, where the values without rows under the other filters wait. See the Job and Started by filters in `backups-list.tsx`.
- Anything that lies at a connection shows whether that connection answers right now with a dot before its name: `success` when it does, `warning` for a missed check, `destructive` with the word offline after three. The hover says since when and where else the record lies, and an action reads from a copy that answers. See `CopyChip` and `AnswerLegend` in `explorer-cells.tsx`.
- A popover that lists many entries, like the destinations behind the freshness of the Storage Explorer, folds them from six on into groups that open and close, the one that needs a look open first. Every row has the same short line, like Compared 38 minutes ago, and one that needs a look shows the date and gives the reason on hover. See `freshness-button.tsx`.
- A list that picks several entries, like the databases of a job, always has its search, a checkbox in its head for the entries the search shows, and a foot with how many are picked and how big they are together. A picked entry the source no longer has stays on top so it can be unticked. See `database-checklist.tsx`.
- A form that maps entries from one place to another, like the databases of a backup to a server, shows them row by row beside what the other side has, like a diff: the new name in a field and what happens as a tag, amber for Overwrites and green for New, with quick filters by outcome. The same rows can show as `lines` in the `ViewSwitch`, from the source on the left to the target on the right, where entries that do the same share one bundle. See `database-rows.tsx` and `database-lines.tsx`.
- A form whose parts depend on each other in one order, like the databases and then the files of a restore, is one step at a time with the steps as two cards on top, and only when both parts exist. The number of the current step takes the quiet gray of a ticked checkbox, `bg-tone-control`, never the white of a button. See `RestoreSteps` in `restore-frame.tsx`.
- A page that starts a run which changes something, like a restore, ends in a bar that stays at the foot while the page scrolls. It says in one sentence what the run does, and why its button waits when it does. The button asks with a `ConfirmDialog` in the tone of the task that lists what is overwritten. It is the only filled button of the bar, a Next to the following step is `outline` like Back and Cancel. See `RestoreBar` in `restore-frame.tsx`.

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
- A measured value over time is one bar per day, neutral with the newest one in `info`. A day nobody measured keeps its place without a bar, so a pause reads as a pause. Above 60 bars the gaps and the rounded corners go, or they eat the bar. See `storage-history-chart.tsx`.

## Dialogs

- The same language applies inside a dialog. The title names the object ("Local"), the description says what the dialog shows, and a headline number follows the card style. See `storage-history-modal.tsx`.
- A confirmation is a `ConfirmDialog` from `ui/confirm-dialog.tsx`. Its head and its confirm button take the tone of the action, red for destructive and amber for a warning or a report of failures, and the head holds an icon tile, the title and a short note such as "Cannot be undone". The dialog sits on `bg-card`, so it stands out from the dimmed page in dark mode, and its buttons sit on a `bg-page/60` strip. See `connection-delete-dialog.tsx`.
- A side panel that opens a record, like the details of a connection, a job or a backup, is a `Sheet` on `bg-card` like a dialog, so it stands out from the dimmed page in dark mode. Strips and lists inside it keep `bg-card` and their borders, see `DetailStats` in `connection-details-sections.tsx`.
- A destructive confirm button is tinted rather than filled and names what it does, like "Delete 7 connections". It keeps the dialog open with a spinner until the request returns.
- A popover that tells how something is doing uses the same tinted `DialogHead`, with the `success` tone when all is well. It sits on `bg-raised`, which in dark mode is one step lighter than the cards, so it stands out from the table under it. See `connection-health-popover.tsx`.
- A tooltip sits on `bg-raised` with a border and an arrow like a popover, never inverted. One that tells a state starts with a `TooltipHead` in the tone of that state and puts the rest in muted text, see `AnswerTip` in `explorer-cells.tsx`.
- A form with more than a handful of fields is split into parts: a list on the left, a `Select` below `md`, and one part at a time beside it at a fixed height, so switching does not make the dialog jump. Each entry shows a check once its part has what it needs and a red count for fields with errors, and Create moves to the first part with one. A form with a single part has no list and gets the narrower dialog. See `connection-form.tsx`, whose parts come from plain data in `database-form-layout.ts`, `storage-form-layout.ts` and `notification-form-layout.ts`, and `job-form.tsx` with its parts in `job-form-layout.ts`.
- A choice that decides what the rest of a form asks for is a pair of cards with one sentence each, not a select. See `ModeChoice` in `connection-mode-choice.tsx`.
- A schedule is picked with `SchedulePicker`, in the job form and the preset dialog alike: a segmented switch for hourly, daily, weekly, monthly and cron, pills that take the tone of the form, shortcuts like Weekdays as small `outline` buttons in a line above them, times typed as 03:00, and a strip with the schedule in words, its time zone and its next runs. When the slots are taken at a start it shows a small amber note with the jobs ahead in the queue and how long the job waits for them, one after the other, with a time that has room and nothing while the slots are enough. The runs of the other jobs are worked out once at a fixed offset (`clashContext` in `lib/core/schedule-conflicts.ts`), since croner with a named time zone is far too slow to check every change, and the check waits for `useDeferredValue` with a skeleton in the note's place.
- A page that creates several things in a row, like the Quick Setup, lists its steps on the left like the parts of a form, each with what it made, and shows one step at a time in a card beside it. Every step has a `DialogHead` in the tone of its task, saving one moves on to the next without a screen in between, and a step that adds a connection embeds `ConnectionForm` with `container="page"` instead of a form of its own. Where entries of the kind exist, the step offers them under Use existing with a `pick` head. See `setup-wizard.tsx`.
- Code to copy is a `CodeBlock` from `ui/code-block.tsx`: the file name and Copy on top, colors that follow the theme, and a `mark` for the value to swap, amber until the dialog fills it in, then green. `mark` takes several values too, the longest winning where they overlap. A dialog that only shows how to use something, like the API trigger, has a `neutral` head, lists its parts on the left like the job form, with group labels and the logos of the languages, and closes with an `outline` Close like every dialog without a main action. A key it makes with `CreateApiKeyDialog` goes into every example until it closes. See `api-trigger-dialog.tsx`, whose examples are plain data in `api-trigger-scripts.ts` and `api-trigger-pipelines.ts`.
- Work that runs by hand on another host, like the restore of a Redis backup, is one script written from a few choices on top: the choice as `ChoiceCards`, its fields, and a setting as a `SwitchRow`. A line above the script says whether its one-time link works and counts it down, amber once it ran out, and segmented tabs in the head of its card switch to the same commands one step at a time with every value filled in. What to do in a rare case folds below, a `Section` with Show. Buttons in such a line are `outline` like in a banner. The script checks what would make the work fail before it changes anything. See `redis-guide.tsx`, whose commands are plain functions in `redis-guide-script.ts`.
- Everything a record can be downloaded as sits in one dialog, like **Download...** of a backup: its parts as groups to tick, each with the head checkbox and the search of a list that picks several entries, one foot that says what the pick comes out as, and segmented tabs for This computer or A server. A server gets one command at a time, curl, wget or PowerShell, with a link for one download whose line says when it was fetched. Every button in it is `outline`, since Download is a neutral task, and it closes with Close. See `download-dialog.tsx`, whose rules are plain functions in `download-model.ts`.
- A copy of an entry, like Clone or Create as directory source, is made in `CloneDialog` from `ui/clone-dialog.tsx`: a `create` head that names the original, a name that is free and selected, so Enter clones and typing replaces it, and a sentence each on what the copy gets and what is left to do. The page mounts it while it has something to copy. See `cloneCopy` in `adapter-manager.tsx`.
- A dialog that creates one of several kinds starts with the list of kinds, headed "Step 1 of 2", and its form offers Change type. When the caller already knows the kind, like the New button of a login field, it opens on the form, names the entry like the field and offers no way to change the kind. See `credential-profile-dialog.tsx` and `AdapterPickerDialog`.
- A path field browses with `FileBrowserDialog`: a `pick` dialog with the path as clickable parts, Type a path, a filter, size and date per entry, hidden entries left out, and the files the field takes marked while the rest are dimmed. It opens where the field points, a file is picked with a click and a folder by standing in it. See `file-browser-dialog.tsx`, whose listing comes from `filesystem-service.ts`.
- A field that picks a saved entry opens a list with a `pick` head that names where the entries come from. Each row says what the entry is and where it is in use, the entries that connections of the same kind use come first, and Edit sits on the row. Its foot holds New, named like the field, and Use none for an entry the connection can do without, both `outline` like every secondary action, or says that one is required. New also sits as an `outline` button beside the field. New and Edit only show for a viewer who may write that kind of entry, checked with `useCan`. The list is `PickList` and the field's button `PickTrigger` from `ui/pick-list.tsx`, see `credential-picker-list.tsx` and `schedule-preset-field.tsx`. A connection field shows the logo of each type in the tile, and its New adds the connection with `AddConnectionDialogs`, the two dialogs of the Connections page, see `connection-picker.tsx`. An entry that stands for none, like No encryption, heads the list with a `glyph` of its own, see `encryption-key-picker.tsx`.
- A fixed choice whose options differ in what they cost, like the compression of a job, is `ChoiceCards` with one sentence per option, never a `PickList`, which is for saved entries with search, Edit and New. An option out of reach stays as a disabled card with a `badge` that says why, and a level is a `Slider` from `ui/slider.tsx` with a `mark` at the default. See `job-part-compression.tsx`.
- A whole number within limits, like the days between full backups, is a `NumberStepper` from `ui/number-stepper.tsx`, which never hands the form a value out of range. When the number shapes what the schedule makes, the part draws that beside it: the Incremental part shows a chain as F and i boxes with a sentence, worked out at the scheduler's offset of today like the clash check, and warns about a long chain with a shorter setting as a button. See `job-part-incremental.tsx` and `incremental-chain.ts`.
- A part with nothing to choose for what the form picked so far is left out of the list, not shown disabled: **SSH server** only over SSH in the connection form, **Incremental** only for a job with folders (`jobParts` in `job-form-layout.ts`). The schema checks its fields only while the part shows, and leaving the mode resets what the part held, so a hidden part never stops the save.
- A field whose setting can make backups replace each other warns in the amber note of the schedule picker, with a way out as a button, like **File names** when two runs of the schedule get the same name. The check follows the runner: `firstNameClash` in `naming-collisions.ts` names the next runs with `applyNamingPattern` in the scheduler's time zone. See `file-names-field.tsx`.
- The notification templates of a job are rows like its destinations, each with its channels and their runs as chips, then the pick field, and last **Who hears about a run**: a table of every channel against succeeded, partial and failed runs over all templates. It counts a channel in two templates twice, like the runner sends it, and warns about it. The template dialog picks each channel with `ConnectionPicker kind="notification"` and its runs with pills. See `job-part-notifications.tsx` and `notification-model.ts`.
- A setting is a sentence that is true when its switch is on, like "Health alerts". A flag stored the other way round, like `healthNotificationsDisabled`, is turned around in the form and stored unchanged. Switches that belong together share one `SwitchList` frame.
- The records a dialog is about go into a `DialogItemList` with icon, name and a short fact. Rows a bulk action leaves out come from its `ineligible` check and get a list of their own under "Will not be deleted" with the reason, so the confirmation says beforehand what happens. See `deleteBlocker` in `connection-bulk-actions.ts`.

## Live data

- A page with live state polls with `DashboardRefresh`: every 3 seconds while a job runs, every 30 seconds otherwise, never in a hidden tab.
- Whatever a poll recomputes must be cheap. The Overview caches its aggregates in `src/services/dashboard/cache.ts`, and a finished backup clears that cache.

## Checklist for a redesigned page

1. Panels are `rounded-xl border bg-card shadow-sm` on the `bg-page` canvas.
2. Numbers use Geist with `tabular-nums`, and no UI text uses `font-mono`.
3. Status colors come from the tokens, every dialog, popover, menu entry and button that serves a task carries its tone, everything else is neutral.
4. Range switches are segmented Tabs and switch without loading again.
5. Loading states are Skeletons shaped like the content.
6. The page works at 375px width and in both themes.
7. The page is added to the Status table above.
