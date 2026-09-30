"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import { Check, CircleCheck, Funnel, MousePointerClick, Pencil, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { saveTaskColorsAction } from "@/app/actions/auth/profile";
import { PartFrame, SaveBar, usePartSave, usePartValues } from "@/components/dashboard/settings/settings-frame";
import { changesOf } from "@/components/dashboard/settings/settings-values";
import { Button } from "@/components/ui/button";
import {
    COLOR_PRESETS,
    DEFAULT_TASK_COLORS,
    TASK_COLOR_KEYS,
    TASK_COLOR_LABELS,
    TASK_COLOR_WHERE,
    colorName,
    presetOf,
    shadesOf,
    taskColorVars,
    type TaskColorKey,
    type TaskColors,
} from "@/lib/core/task-colors";
import { cn } from "@/lib/utils";
import { ColorPicker } from "./color-picker";
import { ColorPreview } from "./color-preview";

const ICONS: Record<TaskColorKey, React.ComponentType<{ className?: string }>> = {
    create: Plus,
    edit: Pencil,
    pick: MousePointerClick,
    filter: Funnel,
    warning: TriangleAlert,
    destructive: Trash2,
    success: CircleCheck,
};

const FIELDS = Object.fromEntries(TASK_COLOR_KEYS.map((key) => [key, { label: TASK_COLOR_LABELS[key], show: colorName }])) as {
    [K in TaskColorKey]: { label: string; show: (value: TaskColors[K]) => string };
};

/** A row of the colors of a choice, in the shades of one theme. */
function Stripe({ colors, theme }: { colors: TaskColors; theme: "light" | "dark" }) {
    return (
        <span className="flex h-2.5 w-full overflow-hidden rounded-full" aria-hidden="true">
            {TASK_COLOR_KEYS.map((key) => <span key={key} className="flex-1" style={{ backgroundColor: shadesOf(colors[key])[theme] }} />)}
        </span>
    );
}

/**
 * The colors of the tasks for the viewer alone: a set to start from, then every task with its shade
 * in both themes and a picker, and pieces of the app that show a choice before it is saved. Saved,
 * the dashboard layout puts it on every page.
 */
export function ColorsPart({ saved }: { saved: TaskColors }) {
    const { resolvedTheme } = useTheme();
    const theme = resolvedTheme === "dark" ? "dark" : "light";
    const form = usePartValues("colors", saved);
    const save = usePartSave("colors");
    const { values, set, replace } = form;
    const preset = presetOf(values);
    const vars = useMemo(() => taskColorVars(values, theme), [values, theme]);
    const isDefault = preset?.id === "default";

    return (
        <>
            <PartFrame
                part="colors"
                flush
                action={
                    <Button type="button" variant="outline" size="sm" disabled={isDefault} onClick={() => replace(DEFAULT_TASK_COLORS)}>
                        <RotateCcw />
                        Reset to default
                    </Button>
                }
            >
                <div data-setting="profile.colors" className="max-w-5xl space-y-6 px-4 py-5 md:px-6">
                    <div className="space-y-2.5">
                        <p className="text-sm font-medium">Start from</p>
                        <div role="radiogroup" aria-label="Start from" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {COLOR_PRESETS.map((option) => {
                                const picked = preset?.id === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={picked}
                                        onClick={() => replace(option.colors)}
                                        className={cn(
                                            "grid gap-2.5 rounded-xl border p-3.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50",
                                            picked && "border-foreground ring-1 ring-foreground"
                                        )}
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className="min-w-0 flex-1 text-sm font-semibold">{option.name}</span>
                                            {picked && <Check className="size-4 shrink-0" aria-hidden="true" />}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{option.description}</span>
                                        <Stripe colors={option.colors} theme={theme} />
                                    </button>
                                );
                            })}
                            <div className={cn("grid gap-2.5 rounded-xl border border-dashed p-3.5", !preset && "border-solid border-foreground ring-1 ring-foreground")}>
                                <span className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 text-sm font-semibold">Your own</span>
                                    {!preset && <Check className="size-4 shrink-0" aria-hidden="true" />}
                                </span>
                                <span className="text-xs text-muted-foreground">{preset ? "Starts once you change one below" : "Your colors, as below"}</span>
                                {preset ? <span className="h-2.5 rounded-full border border-dashed" aria-hidden="true" /> : <Stripe colors={values} theme={theme} />}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border">
                        <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_auto_2rem] items-center gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
                            <span>Task</span>
                            <span>Where it shows</span>
                            <span>Light and dark theme</span>
                            <span className="sr-only">Reset</span>
                        </div>
                        <ul className="divide-y">
                            {TASK_COLOR_KEYS.map((key) => {
                                const Icon = ICONS[key];
                                const changed = values[key] !== DEFAULT_TASK_COLORS[key];
                                const color = shadesOf(values[key])[theme];
                                return (
                                    <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-3 px-4 py-2.5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_auto_2rem] md:gap-4">
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`, color }} aria-hidden="true">
                                                <Icon className="size-3.5" />
                                            </span>
                                            <span className="truncate text-sm font-medium">{TASK_COLOR_LABELS[key]}</span>
                                            {changed && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Yours</span>}
                                        </div>
                                        <p className="hidden truncate text-sm text-muted-foreground md:block" title={TASK_COLOR_WHERE[key]}>{TASK_COLOR_WHERE[key]}</p>
                                        <ColorPicker task={TASK_COLOR_LABELS[key]} value={values[key]} onChange={(value) => set(key, value)} theme={theme} />
                                        {changed ? (
                                            <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => set(key, DEFAULT_TASK_COLORS[key])} aria-label={`${TASK_COLOR_LABELS[key]} back to ${colorName(DEFAULT_TASK_COLORS[key])}`}>
                                                <RotateCcw />
                                            </Button>
                                        ) : (
                                            <span aria-hidden="true" />
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <ColorPreview vars={vars} />
                    <p className="text-xs text-muted-foreground">Warning, Delete and Success also color the states of a run. Running stays blue whatever Add is.</p>
                </div>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, FIELDS)}
                saving={save.saving}
                onDiscard={form.discard}
                onSave={() => save.run(() => saveTaskColorsAction(values), form.commit)}
            />
        </>
    );
}
