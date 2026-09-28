"use client";

import { useId, useMemo, useState } from "react";
import { CircleCheck, CircleSlash, Filter, Loader2, Pencil } from "lucide-react";
import type { ExcludePatternPreset } from "@prisma/client";
import { toast } from "sonner";
import { createExcludePatternPreset, updateExcludePatternPreset } from "@/app/actions/templates";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { currentGroupPattern, EXCLUDE_GROUPS, parseJsonStringArray } from "@/lib/exclude-groups";
import { matchesExcludePattern } from "@/lib/exclude-patterns";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";

const log = logger.child({ component: "ExcludePatternPresetDialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

/** A preset as the dialog edits it: from the Templates page with lists, from the job form as stored. */
export interface EditableExcludePreset {
    id: string;
    name: string;
    description: string | null;
    patterns: string | string[];
    groups: string | string[];
    excludedGroupPatterns: string | string[];
}

/** A folder that skips what the preset names. */
export interface ExcludeUser {
    key: string;
    path: string;
    detail: string;
    adapterId: string;
}

const listOf = (value: string | string[] | undefined) => (Array.isArray(value) ? value : parseJsonStringArray(value));

/** Every pattern the preset skips with where it comes from, the groups first like the backup applies them. */
function skippedBy(groups: string[], optedOut: string[], own: string[]): { pattern: string; from: string }[] {
    const seen = new Set<string>();
    const entries: { pattern: string; from: string }[] = [];
    const add = (pattern: string, from: string) => {
        if (seen.has(pattern)) return;
        seen.add(pattern);
        entries.push({ pattern, from });
    };
    for (const group of EXCLUDE_GROUPS) {
        if (!groups.includes(group.id)) continue;
        for (const pattern of group.patterns) if (!optedOut.includes(pattern)) add(pattern, group.label);
    }
    for (const pattern of own) add(pattern, "its own patterns");
    return entries;
}

/** A path inside a folder, the way the backup matches it: relative, with forward slashes. */
function relative(path: string): string {
    let value = path.trim().replace(/\\/g, "/");
    while (value.startsWith("./")) value = value.slice(2);
    while (value.startsWith("/")) value = value.slice(1);
    return value;
}

/** Whether the backup skips a path, and the pattern that makes it. */
function PathCheck({ entries }: { entries: { pattern: string; from: string }[] }) {
    const [path, setPath] = useState("");
    const id = useId();
    const probe = relative(path);
    const match = probe ? entries.find((entry) => matchesExcludePattern(probe, entry.pattern)) : undefined;
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>Check a path</Label>
            <Input id={id} value={path} onChange={(event) => setPath(event.target.value)} placeholder="app/node_modules/react/index.js" autoComplete="off" spellCheck={false} className="font-mono text-sm" />
            {probe && (
                <div role="status" className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
                    {match ? <CircleSlash className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />}
                    <div className="min-w-0 text-sm">
                        <p className="font-medium">{match ? "Skipped" : "Backed up"}</p>
                        <p className="text-xs text-muted-foreground">
                            {match ? (
                                <>by <span className="font-mono text-foreground">{match.pattern}</span> of {match.from}</>
                            ) : (
                                "No pattern of the preset matches it."
                            )}
                        </p>
                    </div>
                </div>
            )}
            <p className="text-xs text-muted-foreground">A path inside the folder, the way the backup sees it.</p>
        </div>
    );
}

interface PresetFormProps {
    preset?: EditableExcludePreset;
    usedBy?: ExcludeUser[];
    onSuccess: (preset: ExcludePatternPreset) => void;
}

/** The content of the dialog, mounted on every open, so it always starts from the saved preset. */
function PresetForm({ preset, usedBy, onSuccess }: PresetFormProps) {
    const [name, setName] = useState(preset?.name ?? "");
    const [description, setDescription] = useState(preset?.description ?? "");
    const [ownText, setOwnText] = useState(() => listOf(preset?.patterns).join("\n"));
    // Curated groups, referenced rather than copied, so a group extended in a later release reaches the preset.
    const [groups, setGroups] = useState<string[]>(() => listOf(preset?.groups));
    // An opt-out stored before a group folder matched at any depth still names that folder.
    const [optedOut, setOptedOut] = useState<string[]>(() => listOf(preset?.excludedGroupPatterns).map(currentGroupPattern));
    const [nameMissing, setNameMissing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const nameId = useId();
    const tone = preset ? "edit" : "create";
    const own = useMemo(() => ownText.split("\n").map((line) => line.trim()).filter(Boolean), [ownText]);
    const entries = useMemo(() => skippedBy(groups, optedOut, own), [groups, optedOut, own]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            setNameMissing(true);
            return;
        }
        setIsSaving(true);
        // Only opt-outs of groups the preset still follows are kept.
        const excludedGroupPatterns = optedOut.filter((pattern) => EXCLUDE_GROUPS.some((group) => groups.includes(group.id) && group.patterns.includes(pattern)));
        const input = { name: name.trim(), description: description.trim(), patterns: own, groups, excludedGroupPatterns };
        try {
            const res = preset ? await updateExcludePatternPreset(preset.id, input) : await createExcludePatternPreset(input);
            if (res.success && res.data) {
                toast.success(preset ? "Exclude preset updated" : "Exclude preset created");
                onSuccess(res.data);
                return;
            }
            toast.error(res.error || "The preset could not be saved.");
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("Exclude preset could not be saved", {}, wrapError(error));
            toast.error("The preset could not be saved.");
        }
        setIsSaving(false);
    };

    const toggleGroup = (id: string, on: boolean) => setGroups((list) => (on ? [...list, id] : list.filter((entry) => entry !== id)));
    const togglePattern = (pattern: string) => setOptedOut((list) => (list.includes(pattern) ? list.filter((entry) => entry !== pattern) : [...list, pattern]));

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone={tone} icon={preset ? Pencil : Filter} className="px-5 py-4">
                <DialogTitle className="truncate text-base">{preset ? `Edit ${preset.name}` : "New exclude preset"}</DialogTitle>
                <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                    {preset
                        ? usedBy && usedBy.length > 0
                            ? `A change reaches its ${usedBy.length === 1 ? "folder" : `${usedBy.length} folders`} at their next run`
                            : "A change reaches every folder that uses it at its next run"
                        : "What the backup of a folder skips"}
                </DialogDescription>
            </DialogHead>

            <ScrollArea className={BODY_SCROLL}>
                <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor={nameId}>Name</Label>
                            <Input
                                id={nameId}
                                value={name}
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setNameMissing(false);
                                }}
                                placeholder="e.g. Node.js project"
                                autoComplete="off"
                                aria-invalid={nameMissing || undefined}
                                aria-describedby={nameMissing ? `${nameId}-message` : undefined}
                            />
                            {nameMissing && <p id={`${nameId}-message`} className="text-sm text-destructive">Give the preset a name.</p>}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`${nameId}-description`}>Description</Label>
                            <Input id={`${nameId}-description`} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional, like which folders it is meant for" autoComplete="off" />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-baseline justify-between gap-3">
                                <p className="text-sm font-medium">Groups of DBackup</p>
                                <span className="text-xs text-muted-foreground">a click on a pattern leaves it out</span>
                            </div>
                            <ul className="divide-y rounded-lg border">
                                {EXCLUDE_GROUPS.map((group) => {
                                    const active = groups.includes(group.id);
                                    const kept = group.patterns.filter((pattern) => !optedOut.includes(pattern)).length;
                                    return (
                                        <li key={group.id} className="px-3 py-2.5">
                                            <label className="flex cursor-pointer items-start gap-3">
                                                <Checkbox className="mt-0.5" checked={active} onCheckedChange={(checked) => toggleGroup(group.id, checked === true)} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-medium">{group.label}</span>
                                                    <span className="block text-xs text-muted-foreground">{group.description}</span>
                                                </span>
                                                {active && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{kept} of {group.patterns.length}</span>}
                                            </label>
                                            {active && (
                                                <div className="mt-2 flex flex-wrap gap-1 pl-7">
                                                    {group.patterns.map((pattern) => {
                                                        const off = optedOut.includes(pattern);
                                                        return (
                                                            <button
                                                                key={pattern}
                                                                type="button"
                                                                aria-pressed={!off}
                                                                title={off ? "Skip it again" : "Leave it out"}
                                                                onClick={() => togglePattern(pattern)}
                                                                className={cn(
                                                                    "rounded-md border px-1.5 py-0.5 font-mono text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-tone-ring/50",
                                                                    off ? "text-muted-foreground line-through opacity-60" : "hover:bg-muted"
                                                                )}
                                                            >
                                                                {pattern}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor={`${nameId}-own`}>
                                Its own patterns <span className="font-normal text-muted-foreground">one a line</span>
                            </Label>
                            <Textarea id={`${nameId}-own`} value={ownText} onChange={(event) => setOwnText(event.target.value)} placeholder={"*.log\ncoverage/**"} rows={4} className="font-mono text-sm" />
                        </div>
                    </div>

                    <section className="min-w-0 space-y-5 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6" aria-label="What it skips">
                        <div className="space-y-2">
                            <div className="flex items-baseline justify-between gap-3">
                                <p className="text-sm font-semibold">What it skips</p>
                                <span className="text-xs text-muted-foreground tabular-nums">{entries.length === 1 ? "1 pattern" : `${entries.length} patterns`}</span>
                            </div>
                            {entries.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Nothing yet. Pick a group or write a pattern.</p>
                            ) : (
                                <div className="flex flex-wrap gap-1">
                                    {entries.map((entry) => (
                                        <span key={entry.pattern} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs" title={`from ${entry.from}`}>
                                            {entry.pattern}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        <PathCheck entries={entries} />

                        {usedBy && usedBy.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm font-semibold">Used by {usedBy.length === 1 ? "1 folder" : `${usedBy.length} folders`}</p>
                                <ul className="divide-y rounded-lg border">
                                    {usedBy.map((folder) => (
                                        <li key={folder.key} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                                            <AdapterIcon adapterId={folder.adapterId} className="size-4 shrink-0" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-mono text-xs">{folder.path}</span>
                                                <span className="block truncate text-xs text-muted-foreground">{folder.detail}</span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                <DialogClose asChild>
                    <Button type="button" variant="ghost">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="animate-spin" />}
                    {preset ? "Save changes" : "Create preset"}
                </Button>
            </div>
        </form>
    );
}

interface ExcludePatternPresetDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preset?: EditableExcludePreset;
    /** The folders that use it, when the caller knows them. */
    usedBy?: ExcludeUser[];
    onSuccess: (preset: ExcludePatternPreset) => void;
}

/**
 * Adds an exclude preset or changes one: the groups of DBackup it follows with the patterns it
 * leaves out of them, and its own patterns. Beside them it lists what the preset skips and checks a
 * path against it the way the backup does.
 */
export function ExcludePatternPresetDialog({ open, onOpenChange, preset, usedBy, onSuccess }: ExcludePatternPresetDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={preset ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl lg:max-w-5xl")}>
                <PresetForm preset={preset} usedBy={usedBy} onSuccess={onSuccess} />
            </DialogContent>
        </Dialog>
    );
}
