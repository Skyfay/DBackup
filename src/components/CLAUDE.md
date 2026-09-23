# UI and Design System

**These rules govern every `.tsx` file in the project**, including pages and client components under `src/app/`, not just `src/components/`.

Stack: Next.js 16 App Router, Tailwind CSS (mobile-first), Shadcn UI primitives in `src/components/ui/`, forms via `react-hook-form` + `zod`.

The look of the running UI redesign (cards, numbers, colors, switchers, charts) lives in [app/dashboard/CLAUDE.md](../app/dashboard/CLAUDE.md). Read it before building or restyling anything a user sees.

Before building anything, check `src/components/ui/` for an existing primitive. There are 35+ of them. Reaching for a raw `<div>` where a primitive exists is the single most common source of visual drift in this codebase.

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

Four files still set `max-h` on the root. `tests/unit/lint-guards/design-system.test.ts` holds that count as a baseline and fails the build if it grows, so new code cannot add to it.

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

Reference implementation: `AdapterPickerDialog` in `src/components/adapter/adapter-picker.tsx` - it gets both the layout and the viewport selector right. A form split into parts with a list beside them follows `connection-form.tsx` instead. `credential-profile-dialog.tsx` has the layout below but still sets `max-h` on the ScrollArea root, so copy its structure, not its ScrollArea line.

```tsx
<DialogContent className="sm:max-w-xl max-h-[90vh] p-0">
    <div className="px-6 pt-6 pb-4 shrink-0">
        <DialogHeader>
            <DialogTitle>New Credential Profile</DialogTitle>
            <DialogDescription>What this dialog is for.</DialogDescription>
        </DialogHeader>
    </div>

    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-10rem)]">
        <div className="space-y-4 px-6 pb-4">
            {/* body */}
        </div>
    </ScrollArea>

    <div className="px-6 pt-2 pb-6">
        <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
            </Button>
        </DialogFooter>
    </div>
</DialogContent>
```

Rules:
- `p-0` on `DialogContent`, then padding on header / body / footer. Otherwise the scrollbar sits inside the dialog padding and looks detached from the edge.
- `shrink-0` on header and footer so only the body scrolls.
- Viewport max-height subtracts the chrome: roughly `calc(90vh-10rem)` with header and footer, `calc(90vh-9rem)` with header only. Match the dialog's own `max-h`.
- Width via `sm:max-w-*`. Common sizes here: `sm:max-w-md` (confirm), `sm:max-w-xl`, `sm:max-w-2xl`, `sm:max-w-4xl` (permission matrices, adapter forms).

### Accessibility

Every `DialogContent` needs a description. If the visible design has no subtitle, use `<DialogDescription className="sr-only">` or set `aria-describedby={undefined}` explicitly. Radix logs a warning otherwise.

### Destructive confirmations

Use `AlertDialog`, never `Dialog`, and never `window.confirm()` or `alert()`. The destructive button is `<Button variant="destructive">`. New confirmations use `ConfirmDialog` from `@/components/ui/confirm-dialog`, which is that AlertDialog in the redesigned look.

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
- Submit buttons are disabled while pending and show `<Loader2 className="mr-2 h-4 w-4 animate-spin" />`. They take their color from the tone of the dialog, never from a color of their own.
- Field spacing is `space-y-4` inside a form, `space-y-2` inside a single field group.
- Use `z.coerce.number()` for numeric inputs - the DOM gives you strings.
- Never put a validated field into a Radix `TabsContent` that is not rendered. An inactive tab unmounts, so its `FormMessage` never appears and submitting seems to do nothing. Mount every part with `forceMount`, hide the inactive ones with `data-[state=inactive]:hidden`, and move to the part with the error in `handleSubmit`'s invalid callback. See `connection-form.tsx`.

---

## 4. Tables

Use `DataTable` from `@/components/ui/data-table` for any list of records. It handles sorting, pagination, and faceted filters. Reference: `src/components/audit/audit-table.tsx`, `src/app/dashboard/users/user-table.tsx`.

- Define columns as `ColumnDef[]` outside the render path where possible.
- Row actions go in a `DropdownMenu` triggered by `<Button variant="ghost" className="h-8 w-8 p-0">` with `<MoreHorizontal className="h-4 w-4" />` and an `<span className="sr-only">Open menu</span>`.
- Filter chips use `data-table-faceted-filter`.
- Row actions that a right click should also offer are declared once as data, like `connectionActions`, and rendered by both the menu button and `renderRowMenu`.
- A plain `<Table>` is fine for small static, non-interactive data.

---

## 5. Color and dark mode

Use semantic tokens. They are already theme-aware:

`bg-background` `bg-card` `bg-muted` `bg-popover` `text-foreground` `text-muted-foreground` `text-destructive` `border-border` `ring-ring` `bg-primary` `bg-secondary` `bg-accent`

`text-muted-foreground` is used 600+ times here - it is the default for secondary text, helper copy, and icons that are not the focus.

`bg-page` is the dashboard canvas behind the cards: gray in light mode, identical to `bg-background` in dark mode. `bg-background` stays white in light mode because dialogs, active tabs, and outline buttons build on it, so never use it to paint a page-level area.

**Raw palette colors (`text-green-600`, `bg-red-100`, ...) must always ship a `dark:` variant.** A `bg-green-100 text-green-600` with no dark variant is unreadable in dark mode, and that bug already exists in a couple of older files. Correct form:

```tsx
<Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
```

Prefer a `Badge` variant or the status tokens (`success`, `warning`, `destructive`, `info`) over ad-hoc status colors. The connection status is drawn by `StatusCell` in `@/components/adapter/connection-cells`.

**Task colors.** A dialog, popover, menu entry or button that adds, edits, picks, warns or deletes gets a `tone` from `@/components/ui/tone`, never a hardcoded color: `<DialogContent tone="create">`, `<AlertDialogContent tone="destructive">`, `<PopoverContent tone="pick">`, `<Button tone="create">` for a New button on a page. The filled button, the `DialogHead`, picked cards, switches, checkboxes, radio buttons and the focus ring of fields inside read the tone through `bg-tone`, `text-tone` and `ring-tone-ring`, so a form that adds and edits only sets `tone={initialData ? "edit" : "create"}`. Outside a task switches, checkboxes and radio buttons are a quiet gray. Never give one a checked color of its own. Which tone a task gets is under Color in [app/dashboard/CLAUDE.md](../app/dashboard/CLAUDE.md), how it works in `docs/developer-guide/core/colors.md`. `info` is the running status and nothing else.

---

## 6. Tailwind conventions

- No inline `style={{...}}`. Exception: genuinely computed values such as chart colors or progress percentages. Keep those on the one element that needs them.
- Prefer standard utilities over arbitrary values: `h-px` not `h-[1px]`, `w-4` not `w-[1rem]`.
- Mobile-first. Unprefixed classes are the small-screen case, `sm:` / `md:` / `lg:` widen from there.
- Page sections use `space-y-6`, groups within a section `space-y-4`, tight pairs `space-y-2`.
- Compose conditional classes with `cn()` from `@/lib/utils`, not template strings.

---

## 7. Icons

`lucide-react` is the default (117 import sites). Standard sizes: `h-4 w-4` inline with text, `h-5 w-5` for standalone buttons, `h-3 w-3` inside badges.

`@iconify/react` is used only for brand and product logos (adapter icons, OIDC providers) via `@iconify-icons/simple-icons`, `-logos`, and `-mdi`. New adapters register their icon in `src/components/adapter/utils.ts` (`ADAPTER_ICON_MAP`), otherwise the UI falls back to a generic icon.

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

- Success and error feedback: `toast` from `sonner`. Never `alert()`.
- User-facing errors go through `toast`. The logger is for diagnostics, not for the user - they are not interchangeable, and an error usually needs both.
- Pending buttons: `disabled={isSaving}` plus `<Loader2 className="h-4 w-4 animate-spin" />`.
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

---

## What is enforced automatically

`tests/unit/lint-guards/design-system.test.ts` runs in `pnpm test` and `pnpm validate`:

| Rule | Mode |
| :--- | :--- |
| Raw `overflow-y-auto` instead of ScrollArea | Fails the build |
| Locale date formatting | Fails the build |
| `max-h` on the ScrollArea root | Baseline of 4, fails if it grows |
| Palette color with no `dark:` variant | Baseline of 86, fails if it grows |
| `info` blue outside the running status, raw `data-tone` attribute | Fails the build |

Baselines may only be lowered. Fix violations, drop the number, and the guard locks the win in. Everything else in this guide is on you.

## Pre-commit UI checklist

1. Every overflowing container is a `ScrollArea`, with the max-height on the **viewport** and `min-h-0` on flex children.
2. Dialogs use `p-0` + padded header/body/footer, and have a `DialogDescription`.
3. No `console.*`. No `alert()` or `confirm()`.
4. No `.toLocaleDateString()` / `.toLocaleTimeString()` / `.toLocaleString()` on dates.
5. Raw palette colors carry a `dark:` variant. Checked the page in dark mode.
6. Every dialog, popover or button that adds, edits, picks, warns or deletes has its `tone`.
7. Submit buttons disable and show a spinner while pending.
8. No inline `style` outside computed values.
9. Checked `src/components/ui/` before writing a new primitive.
10. `pnpm run build` passes.
