# Task Colors

Every dialog, popover, menu entry and button in DBackup takes the color of its task. Adding is blue, editing violet, picking turquoise, filtering fuchsia, warning amber and deleting red. Everything else stays neutral. This page explains the rule and how the code applies it.

## The Tones

| Tone | Color | Task | Examples |
| :--- | :--- | :--- | :--- |
| `create` | Blue | Adds a new entry | New database, Create job, Clone, the type picker before a form |
| `edit` | Violet | Changes an entry that exists | Edit database, Edit user, Edit template |
| `pick` | Turquoise | Chooses an entry that exists | A saved login, a folder, a file, the databases of a job |
| `filter` | Fuchsia | Narrows what a list shows | The filters of every table, framed in it once they hold something |
| `warning` | Amber | Warns before going on, or reports what failed | Save anyway, Restore, the result of a bulk action |
| `destructive` | Red | Loses something | Delete, Remove, Revoke |
| `success` | Green | Reports that all is well | Never on an action |
| `neutral` | Primary | Everything else | Settings, pages, menus, Sign in, Test, Download |

The list is closed on purpose. An area of the app, like the Vault or the templates, never gets a color of its own. Every extra color is one more meaning to learn, and the palette has no hue left that does not look like one of the above. Filtering took the last free one, since it is a task of its own: it changes no data and only narrows what a list shows.

Status colors are a separate layer: green for completed, amber for partial, red for failed and blue for running. They show up as dots, badges, tinted rows, chart bars and the first line of a tooltip that tells a state, never on an action. The `info` token is reserved for the running status and the newest bar of a chart.

## How It Works

A tone is a CSS custom property that a `data-tone` attribute sets for an element and everything inside it. The rules live in `src/app/globals.css`:

```css
[data-tone="edit"] {
  --tone: var(--edit);
  --tone-foreground: var(--edit-foreground);
  --tone-ring: var(--edit);
  --tone-control: var(--edit);
  --tone-control-foreground: var(--edit-foreground);
}
```

Without an attribute, `--tone` is the neutral `--primary`. Tailwind exposes it as the `tone` color, so `bg-tone`, `text-tone` and `border-tone/60` resolve to the tone of the nearest element that sets one. Dialogs, popovers and menus render in a portal, so each sets its own tone and nothing leaks in from the page behind it.

The primitives take a typed `tone` prop from `src/components/ui/tone.ts` and write the attribute:

| Primitive | What the tone does |
| :--- | :--- |
| `DialogContent`, `AlertDialogContent`, `PopoverContent` | Everything inside follows it |
| `Button` | The filled variant uses `bg-tone`. A `tone` on the button itself overrides its surroundings. |
| `DialogHead` | Tints the head and its icon tile |
| `ContextMenuItem`, `DropdownMenuItem` | Icon in the tone, a frame and a light tint while highlighted |
| `Switch`, `Checkbox`, `RadioGroupItem` | On, checked and picked in `--tone-control` |
| `Input`, `Textarea`, `SelectTrigger`, `TagInput` | Focus ring from `--tone-ring` |

`--tone-ring` follows `create`, `edit`, `pick` and `filter` and stays the quiet gray `--ring` for every other tone. A red or amber border on a field reads as an error, so a destructive or warning dialog keeps the gray ring on its fields.

`--tone-control` is the tone of the task for switches, checkboxes and radio buttons. Where there is no task, on a page, in Settings or in a neutral dialog, it is `--control-neutral`, a quiet gray instead of the white or black of a neutral button, so a setting that is on never outshines the page.

## Usage

```tsx
// A dialog that adds or edits, colored once for both
<DialogContent tone={initialData ? "edit" : "create"}>
  ...
  <Button type="submit">{initialData ? "Save changes" : "Create"}</Button>
</DialogContent>

// A New button on a neutral page
<Button tone="create" onClick={openCreate}>
  <Plus /> New template
</Button>

// A popover that chooses a saved entry
<PopoverContent tone="pick">...</PopoverContent>
```

A component that needs the color itself reads it through the `tone` utilities, like the picked card in `connection-mode-choice.tsx` with `has-data-[state=checked]:border-tone/60`. It never names a task color directly. A plain element that starts a task, like a step of the setup wizard, sets the tone with `{...toneAttribute("create")}` from `src/components/ui/tone.ts`.

## Rules

- One tone per dialog, popover or menu entry, set where the task starts.
- Pages are neutral. Only a button that opens a toned dialog carries the tone, and a Delete button is `variant="destructive"`.
- The filled button of a view follows the tone and is its one main action. Every other button is `outline` or `ghost`.
- A menu entry takes the tone of the dialog it opens, the head of the menu stays neutral. See `connectionActions` in `src/components/adapter/connection-actions.ts`.
- `tests/unit/lint-guards/design-system.test.ts` fails the build on the `info` blue outside the running status and on a raw `data-tone` attribute, which would skip the type check of the tone.

## Changing a Color

The task colors are CSS variables in `src/app/globals.css`, one per theme, each with a `-foreground` for text on top of it:

```css
:root {
  --edit: oklch(0.541 0.247 293); /* #7c3aed */
  --edit-foreground: oklch(0.985 0 0);
}

.dark {
  --edit: oklch(0.709 0.159 293.5); /* #a78bfa */
  --edit-foreground: oklch(0.169 0.004 286);
}
```

Changing a task color means changing these values and nothing else, since no component names a task color. The quiet gray of switches and checkboxes outside a task is `--control-neutral` in the same file. A foreground has to keep a contrast of 4.5:1 against its color. That is why light mode uses the darker shades with white text and dark mode the lighter shades with dark text.
