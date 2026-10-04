# UI and Design System

**These rules govern every `.tsx` file in the project**, including pages and client components under `src/app/`, not just `src/components/`.

Stack: Next.js 16 App Router, Tailwind CSS (mobile-first), Shadcn UI primitives in `src/components/ui/`, forms via `react-hook-form` + `zod`.

The look of the running UI redesign (cards, numbers, colors, switchers, charts) lives in [app/dashboard/CLAUDE.md](../app/dashboard/CLAUDE.md). Read it before building or restyling anything a user sees.

Before building anything, check `src/components/ui/` for an existing primitive. Most needs are covered there already, and reaching for a raw `<div>` where a primitive exists is the single most common source of visual drift in this codebase.

---

## 1. ScrollArea - the rule that gets forgotten most

**Any container that can overflow uses `<ScrollArea>` from `@/components/ui/scroll-area`. Never a raw `overflow-y-auto` div.**

A raw overflow container renders the native OS scrollbar, which sits next to the styled Radix scrollbar used everywhere else and looks wrong - especially on Windows and in dark mode. Check this before finishing any dialog, dropdown, log viewer, list panel, or preview pane.

### Where the max-height goes

This is the part that silently fails. `ScrollArea` renders a Radix Root wrapping a Viewport, and the **Viewport** is the element that gets `overflow-y: scroll` - our wrapper sizes it with `size-full`, so its height is `100%`. A percentage height cannot resolve against a parent that only carries a `max-height`, so a `max-h-*` on the root leaves the scrolling element unconstrained. Put it on the viewport:

```tsx
<ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-9rem)]">
```

`*:data-[slot=scroll-area-viewport]:` is the canonical selector - it matches the `data-slot` our wrapper sets in `ui/scroll-area.tsx`. A few older files use `*:data-radix-scroll-area-viewport:`. Both work at runtime, but do not copy the old form into new code.

No file sets `max-h` on the root any more, and `tests/unit/lint-guards/design-system.test.ts` fails the build on a new one.

### Long text inside

Radix wraps the content of the viewport in a table, which grows with its widest line so it can scroll sideways. Our `ScrollArea` turns that wrapper into a block unless it has `horizontal`, so text inside truncates at the width it is given instead of being cut off at the edge. Older files still add `[&>[data-slot=scroll-area-viewport]>div]:block!` by hand, new code does not need it.

### Filling the remaining height in a flex parent

```tsx
<ScrollArea className="flex-1 min-h-0">
```

`min-h-0` is mandatory. Without it the flex child refuses to shrink below its content size and the scroll never engages - the page grows instead. This is the second most common ScrollArea bug here.

### Programmatic scrolling

`ScrollArea` accepts a `viewportRef` prop (our addition, not stock Shadcn). Use it to scroll to bottom for live logs rather than reaching into the DOM.

---

## 2. Dialogs

### Scrollable dialog (canonical)

Reference implementation: `AdapterPickerDialog` in `src/components/adapter/adapter-picker.tsx` - it gets both the layout and the viewport selector right. A form split into parts with a list beside them follows `connection-form.tsx` instead, and a short form with a tinted head follows `credential-profile-dialog.tsx`.

```tsx
<DialogContent tone="create" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
    <DialogHead tone="create" icon={KeyRound}>
        <DialogTitle className="text-base">New credential profile</DialogTitle>
        <DialogDescription className={dialogNoteClass("create")}>What this dialog is for</DialogDescription>
    </DialogHead>

    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
        <div className="space-y-4 p-5">
            {/* body */}
        </div>
    </ScrollArea>

    <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={submit} disabled={isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            Save changes
        </Button>
    </div>
</DialogContent>
```

Rules:
- `DIALOG_SURFACE` from `@/components/ui/confirm-dialog` on `DialogContent`, which drops its padding, so the `DialogHead`, the body and the `DIALOG_FOOTER` strip pad themselves and the scrollbar sits at the edge.
- The `DialogHead` and the `DIALOG_FOOTER` never shrink, so only the body scrolls.
- The viewport max-height subtracts head and foot from the `95dvh` of the dialog: `calc(95dvh-9.5rem)` with both.
- Width via `sm:max-w-*`. Common sizes here: `sm:max-w-md` (confirm), `sm:max-w-xl`, `sm:max-w-2xl`, `sm:max-w-4xl` (permission matrices, adapter forms).
- A dialog opened from inside a form, like New preset in the job form, may hold a `<form>` of its own. React passes its submit through the portal to the form behind it, so `DialogContent` stops the event. Keep such a form inside `DialogContent`, never around it.

### Accessibility

Every `DialogContent` needs a description. If the visible design has no subtitle, use `<DialogDescription className="sr-only">` or set `aria-describedby={undefined}` explicitly. Radix logs a warning otherwise.

### Destructive confirmations

Use `AlertDialog`, never `Dialog`, and never `window.confirm()` or `alert()`. The destructive button is `<Button variant="destructive">`. New confirmations use `ConfirmDialog` from `@/components/ui/confirm-dialog`, which is that AlertDialog in the redesigned look. Its body scrolls between the head and the buttons once it is taller than the window, and a confirmation about a cancel names its own button with `cancelLabel`, like Keep it running, so it never shows two Cancels.

---

## 3. Forms

`react-hook-form` + `zod` via `@hookform/resolvers`. Reference: `src/components/adapter/connection-form.tsx` with its state in `use-connection-form.ts`.

```tsx
<FormField
    control={form.control}
    name="host"
    render={({ field }) => (
        <FormItem>
            <FormLabel>Host</FormLabel>
            <FormControl><Input placeholder="localhost" {...field} /></FormControl>
            <FormDescription>Optional helper text.</FormDescription>
            <FormMessage />
        </FormItem>
    )}
/>
```

- Always include `<FormMessage />`. A field without it fails validation silently.
- Never hand-roll a `<label>` - use `FormLabel`, or `Label` with a matching `htmlFor` when outside a `Form`.
- Submit buttons are disabled while pending and show `<Loader2 className="animate-spin" />`, the button spaces and sizes its icon itself. They take their color from the tone of the dialog, never from a color of their own.
- Field spacing is `space-y-4` inside a form, `space-y-2` inside a single field group.
- Use `z.coerce.number()` for numeric inputs - the DOM gives you strings.
- Never put a validated field into a Radix `TabsContent` that is not rendered. An inactive tab unmounts, so its `FormMessage` never appears and submitting seems to do nothing. Mount every part with `forceMount`, hide the inactive ones with `data-[state=inactive]:hidden`, and move to the part with the error in `handleSubmit`'s invalid callback. See `connection-form.tsx`.

---

## 4. Tables

Use `DataTable` from `@/components/ui/data-table` for any list of records. It handles sorting, pagination, and faceted filters. Reference: `src/components/dashboard/users/users-tab.tsx` with `user-columns.tsx`, and `src/components/dashboard/vault/credentials-tab.tsx`.

- Define columns as `ColumnDef[]` outside the render path where possible.
- A list whose records a link opens, like `?open=<id>` from the search in the header, calls `useOpenFromLink(rows, open)` from `@/hooks/use-open-from-link` with its rows, null until they loaded. The hook takes the id off the address again, so the next link to the page that is already open opens its record too.
- Row actions go in a `DropdownMenu` triggered by `<Button variant="ghost" className="h-8 w-8 p-0">` with `<MoreHorizontal className="h-4 w-4" />` and an `<span className="sr-only">Open menu</span>`.
- Column filters use `data-table-faceted-filter`. Its field is framed in the `filter` tone once it holds something, and its list has a `filter` head, a search with a box for every value it shows, a checkbox per value with how many rows it leaves, and a foot with how many are picked and Clear. Values no row has under the other filters sit at the end and cannot be picked.
- Row actions that a right click should also offer are declared once as data, like `connectionActions`, and rendered by both the menu button and `renderRowMenu`.
- `DataTable` has one look, a card with its toolbar inside. A table that fills a pane of a card, like the system tasks in Settings, takes `frameless`, so it has no frame of its own inside the card.
- A plain `<Table>` is fine for small static, non-interactive data.
- `Table` from `ui/table` sits in a `ScrollArea horizontal`, so a table wider than its box scrolls sideways with the scrollbar of the app, never the one of the browser. Every `DataTable` gets it from there. Never wrap a table in an `overflow-x-auto` box of its own.
- Rows that scroll inside a pane of fixed height with a head that sticks take the parts of `ui/table` straight inside a `ScrollArea horizontal` that carries the height, without the `Table` wrapper. Its scroll area has no height, and the head would stick to it instead. See `Grid` in `database-grids.tsx`.

---

## 5. Color and dark mode

Use semantic tokens. They are already theme-aware:

`bg-background` `bg-card` `bg-muted` `bg-popover` `text-foreground` `text-muted-foreground` `text-destructive` `border-border` `ring-ring` `bg-primary` `bg-secondary` `bg-accent`

`text-muted-foreground` is the default for secondary text, helper copy, and icons that are not the focus.

`bg-page` is the dashboard canvas behind the cards: gray in light mode, identical to `bg-background` in dark mode. `bg-background` stays white in light mode because dialogs, active tabs, and outline buttons build on it, so never use it to paint a page-level area.

**Raw palette colors (`text-green-600`, `bg-red-100`, ...) must always ship a `dark:` variant.** A `bg-green-100 text-green-600` with no dark variant is unreadable in dark mode, and the design guard fails the build on one. Correct form:

```tsx
<Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
```

Prefer a `Badge` variant or the status tokens (`success`, `warning`, `destructive`, `info`) over ad-hoc status colors. The connection status is drawn by `StatusCell` in `@/components/adapter/connection-cells`.

**Task colors.** A dialog, popover, menu entry or button that adds, edits, picks, warns or deletes gets a `tone` from `@/components/ui/tone`, never a hardcoded color: `<DialogContent tone="create">`, `<AlertDialogContent tone="destructive">`, `<PopoverContent tone="pick">`, `<Button tone="create">` for a New button on a page. The filled button, the `DialogHead`, picked cards, switches, checkboxes, radio buttons and the focus ring of fields inside read the tone through `bg-tone`, `text-tone` and `ring-tone-ring`, so a form that adds and edits only sets `tone={initialData ? "edit" : "create"}`. Outside a task switches, checkboxes, radio buttons and picked cards that are on are the soft gray `--control-neutral`. Never give one a checked color of its own. Which tone a task gets is under Color in [app/dashboard/CLAUDE.md](../app/dashboard/CLAUDE.md), how it works in `docs/developer-guide/core/colors.md`. `info` is the running status and nothing else.

**Floating panels.** Popovers, dropdown menus, selects and context menus share one surface: `bg-raised` with a border and `rounded-xl`, their entries `rounded-md`, so the actions of a row look the same from its button and from a right click. A call site sets no surface of its own. A tooltip and the tooltip of a chart, `CHART_TOOLTIP` in `ui/chart.tsx`, are `bg-raised` and `rounded-lg`.

---

## 6. Tailwind conventions

- No inline `style={{...}}`. Exception: genuinely computed values such as chart colors or progress percentages. Keep those on the one element that needs them.
- Prefer standard utilities over arbitrary values: `h-px` not `h-[1px]`, `w-4` not `w-[1rem]`.
- Mobile-first. Unprefixed classes are the small-screen case, `sm:` / `md:` / `lg:` widen from there.
- Page sections use `space-y-6`, groups within a section `space-y-4`, tight pairs `space-y-2`.
- Compose conditional classes with `cn()` from `@/lib/utils`, not template strings.

---

## 7. Icons

`lucide-react` is the default. Standard sizes: `h-4 w-4` inline with text, `h-5 w-5` for standalone buttons, `h-3 w-3` inside badges.

`@iconify/react` is used only for brand and product logos via `@iconify-icons/simple-icons`, `-logos`, and `-mdi`. New adapters register their icon in `src/components/adapter/utils.ts` (`ADAPTER_ICON_MAP`), otherwise the UI falls back to a generic icon. The logos of the sign-in providers are local data in `src/components/oidc/provider-logos.ts`, taken from selfh.st/icons and Simple Icons, since the installed icon sets lack most of them. They keep their brand colors in both themes like the adapter logos, and Pocket ID, which has none, takes the color of the text. `ProviderLogo` and `ProviderTile` draw them.

---

## 8. Dates and numbers

Every user carries **three** display preferences on their session: `timezone`, `dateFormat`, and `timeFormat`. Timestamps are stored in UTC and only become a wall-clock time at render, so every place a date or time reaches the screen must go through the shared formatter. There is no exception for "just a tooltip" or "just a preview".

**Forbidden**: `.toLocaleDateString()`, `.toLocaleTimeString()`, and `.toLocaleString()` on a `Date`, plus any other direct locale formatting. These read the browser locale instead of the user's settings and look correct on your own machine, which is why they keep reappearing in chart tooltips, table cells, and preview components.

### The two entry points

| Use | When |
| :--- | :--- |
| `<DateDisplay date={x} />` from `@/components/utils/date-display` | Rendering a timestamp as its own element. Emits semantic `<time dateTime={iso}>` and handles the SSR hydration mismatch. |
| `useDateFormatter()` from `@/hooks/use-date-formatter` | You need the string itself - inside a template, a chart tooltip, a table `cell`, an aria-label. Returns `{ formatDate }`. |

### The format tokens are the trap

Both take a `date-fns` format string defaulting to `"Pp"`, but the localized tokens are **substituted with the user's preference**, not passed through:

| Format you pass | What is actually used |
| :--- | :--- |
| `"P"`, `"PP"`, `"PPP"` | the user's `dateFormat` |
| `"p"`, `"pp"` | the user's `timeFormat` |
| `"Pp"`, `"PP pp"` | `dateFormat` + `timeFormat` |
| `"dd.MM.yyyy"` or any other literal | **used verbatim - the user's format preference is ignored** |

So `formatDate(x, "dd.MM.yyyy")` still converts into the user's timezone but overrides the format they chose. Only reach for a literal pattern when the format is genuinely fixed by context (a log line, a filename, an axis label that must stay compact), and treat it as a deliberate choice rather than a default.

`DateDisplay` also takes an explicit `timezone` prop that overrides the user's - used where a value is defined by the server's clock rather than the viewer's.

### Numbers

`.toLocaleString()` for thousands separators is fine - there is no timezone in a row count. Check `formatBytes` and `formatDuration` in `@/lib/utils` first, they likely already cover the case.

---

## 9. Feedback and loading

- Success and error feedback: `toast` from `sonner`. Never `alert()`. The look comes from `ui/sonner.tsx`: a quiet card with the icon in the color of the kind and a line along its foot for the time left, which stops while the toasts are hovered. Hovering shows Close, and Copy on errors and warnings, so pass no colors or classes of your own.
- User-facing errors go through `toast`. The logger is for diagnostics, not for the user - they are not interchangeable, and an error usually needs both.
- Pending buttons: `disabled={isSaving}` plus `<Loader2 className="animate-spin" />`.
- A button that loads a list again is `RefreshButton` from `@/components/ui/refresh-button`, never a plain icon button. It turns for at least one full turn after a click, longer while the promise of `onRefresh` or its `busy` runs, and ignores clicks meanwhile, so a list that loads in a blink still answers and the button cannot be fired again and again. The toolbar of every `DataTable` uses it.
- Copy buttons put their text on the clipboard with `copyToClipboard` from `@/lib/clipboard`, which also works on a DBackup served over plain HTTP, and show Copied only when it answered true. A failure shows `COPY_FAILED` in a toast. Never call `navigator.clipboard` yourself.
- A page that fails shows the `error.tsx` of its segment, built from `PageProblem` in `components/layout/page-problem.tsx`: inside the dashboard with the sidebar, outside it on a page of its own. An unknown address shows `app/not-found.tsx`.
- Initial page and section loads: `Skeleton` from `@/components/ui/skeleton`, shaped like the content it replaces. A bare centered spinner for a whole page is a last resort.
- Empty states get a short explanation and, where it makes sense, the primary action - not a blank panel.

---

## 10. Logging in components

Never `console.log` / `console.error` / `console.warn`, including inside `.catch()`. Import `logger` from `@/lib/logging/logger` - it has no Node-only dependencies and is safe in both Server and Client Components.

Never log whole session, user, or config objects. Log the specific field (`{ userId }`, not `user`). Client logs land in the browser console where anyone can read them.

---

## 11. Server vs Client Components

- Default to Server Components. Add `"use client"` only for interactivity.
- `page.tsx` should rarely be a Client Component. Fetch in the page, pass props to a child client component that owns the interactive part. Reference: `src/app/dashboard/jobs/page.tsx` fetching and handing off to `jobs-client.tsx`.
- Before adding `"use client"` to a page, check whether only a sub-tree actually needs it.
- Type all props with explicit interfaces. No implicit `any`.
- Permission flags are resolved server-side (`getUserPermissions()`) and passed down as booleans such as `canManage`, `canExecute`. Do not re-check permissions in the client for security - client checks are for hiding UI only.
- A control deep inside a form, like New in a pick field, reads the same list with `useCan(PERMISSIONS.X.WRITE)` from `@/components/permissions/permissions-context` instead of a prop through every level. The dashboard layout provides it, and outside a provider, like in a test, it hides nothing.

---

## What is enforced automatically

`tests/unit/lint-guards/design-system.test.ts` runs in `pnpm test` and `pnpm validate`:

| Rule | Mode |
| :--- | :--- |
| Raw `overflow-y-auto`, `overflow-x-auto` or `overflow-scroll` instead of ScrollArea | Fails the build |
| Locale date formatting, the primitives included | Fails the build |
| `max-h` on the ScrollArea root | Fails the build, baseline 0 |
| Palette color with no `dark:` variant, the primitives included | Fails the build, baseline 0 |
| `info` blue outside the running status, raw `data-tone` attribute | Fails the build |
| A page of the dashboard without `loading.tsx` or a title (`dashboard-pages.test.ts`) | Fails the build |
| `public/openapi.yaml` apart from `api-docs/openapi.yaml` (`openapi-copies.test.ts`) | Fails the build |

Baselines may only be lowered, and both are at zero. Only the scroll rule leaves out `src/components/ui/`, where Radix scrolls the content of its menus itself, and a rule sees only a `className=` on the same line. Everything else in this guide is on you.

## Pre-commit UI checklist

1. Every overflowing container is a `ScrollArea`, with the max-height on the **viewport** and `min-h-0` on flex children.
2. Dialogs use `DIALOG_SURFACE` with a `DialogHead`, a `ScrollArea` body and `DIALOG_FOOTER`, and have a `DialogDescription`.
3. No `console.*`. No `alert()` or `confirm()`.
4. No `.toLocaleDateString()` / `.toLocaleTimeString()` / `.toLocaleString()` on dates.
5. Raw palette colors carry a `dark:` variant. Checked the page in dark mode.
6. Every dialog, popover or button that adds, edits, picks, warns or deletes has its `tone`.
7. Submit buttons disable and show a spinner while pending.
8. No inline `style` outside computed values.
9. Checked `src/components/ui/` before writing a new primitive.
10. `pnpm run build` passes.
