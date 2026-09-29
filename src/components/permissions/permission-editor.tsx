"use client";

import { useId, useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listWords } from "@/lib/auth/access-summary";
import { countIn, LEVEL_LABELS, levelOf, PERMISSION_AREAS, permissionInfo, withLevel, withPermission, type Level, type PermissionArea } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import { LevelPicker } from "./level-picker";

interface PermissionEditorProps {
    /** Above the areas, like the name of a group or the name and the end of a key. */
    fields: React.ReactNode;
    held: ReadonlySet<string>;
    onHeldChange: (next: Set<string>) => void;
    /** Why a permission may not be given, like the group of the owner of a key lacking it, or null. */
    lockedReason?: (permission: string) => string | null;
    /**
     * Ticks what a permission needs along with it, like See the backups with Restore. A group needs
     * it to find its way in the app, an API key calls one route and gets exactly what is ticked.
     */
    withNeeds?: boolean;
    /** Under the permissions, like who gets every change. */
    note?: React.ReactNode;
    /** The areas whose level changed, marked in the list. */
    changedAreas?: ReadonlySet<string>;
}

/**
 * The permissions of a group or an API key, one area at a time: the areas with their level on the
 * left, a `Select` of them on a phone, and the open area with its level and every permission of it
 * on the right. The height stays the same from area to area, so the dialog does not jump.
 */
export function PermissionEditor({ fields, held, onHeldChange, lockedReason, withNeeds = true, note, changedAreas }: PermissionEditorProps) {
    const [active, setActive] = useState(PERMISSION_AREAS[0].id);
    const area = PERMISSION_AREAS.find((entry) => entry.id === active) ?? PERMISSION_AREAS[0];

    return (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15.5rem_minmax(0,1fr)] md:grid-rows-1">
            <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
                <div className="space-y-4 px-3 pt-4 pb-3">{fields}</div>

                <div className="px-3 pb-4 md:hidden">
                    <Select value={area.id} onValueChange={setActive}>
                        <SelectTrigger aria-label="Area" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PERMISSION_AREAS.map((entry) => (
                                <SelectItem key={entry.id} value={entry.id}>
                                    {entry.label} · {LEVEL_LABELS[levelOf(entry, held)]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <ScrollArea className="hidden min-h-0 flex-1 md:block">
                    <nav aria-label="Areas" className="space-y-0.5 px-3 pb-3">
                        {PERMISSION_AREAS.map((entry) => {
                            const level = levelOf(entry, held);
                            const on = entry.id === area.id;
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => setActive(entry.id)}
                                    aria-current={on ? "true" : undefined}
                                    // The frame is drawn inside, since the scroll area cuts off whatever lies outside it,
                                    // which took the top line of the first area.
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ring-inset outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                                        on ? "bg-tone/10 font-semibold ring-1 ring-tone/45 dark:bg-tone/15" : "font-medium hover:bg-muted/60"
                                    )}
                                >
                                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                                    {changedAreas?.has(entry.id) && <span className="size-1.5 shrink-0 rounded-full bg-tone" aria-label="changed" />}
                                    <span className={cn("shrink-0 text-xs font-normal", level === "none" ? "text-muted-foreground" : "text-foreground")}>{LEVEL_LABELS[level]}</span>
                                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                </button>
                            );
                        })}
                    </nav>
                </ScrollArea>
            </div>

            <ScrollArea className="min-h-0">
                <AreaPane area={area} held={held} onHeldChange={onHeldChange} lockedReason={lockedReason} withNeeds={withNeeds} note={note} />
            </ScrollArea>
        </div>
    );
}

interface AreaPaneProps {
    area: PermissionArea;
    held: ReadonlySet<string>;
    onHeldChange: (next: Set<string>) => void;
    lockedReason?: (permission: string) => string | null;
    withNeeds: boolean;
    note?: React.ReactNode;
}

/** Ticks or unticks one permission alone, for an API key, which gets exactly what is ticked. */
function toggleAlone(held: ReadonlySet<string>, id: string, on: boolean): Set<string> {
    const next = new Set(held);
    if (on) next.add(id);
    else next.delete(id);
    return next;
}

/** One area: its level, then every permission with a sentence, what it needs and why it may be locked. */
function AreaPane({ area, held, onHeldChange, lockedReason, withNeeds, note }: AreaPaneProps) {
    const idBase = useId();
    const level = levelOf(area, held);
    // A permission is locked when it may not be given, or when what it needs may not be.
    const lockOf = (id: string): string | null => {
        const own = lockedReason?.(id) ?? null;
        if (own || !withNeeds) return own;
        for (const needed of permissionInfo(id)?.needs ?? []) {
            const reason = lockedReason?.(needed) ?? null;
            if (reason) return reason;
        }
        return null;
    };
    // A level only adds what is not held yet, so a locked permission that is held already never blocks it.
    const blocked = (target: Level) =>
        (area.levels[target as Exclude<Level, "none">] ?? []).filter((id) => !held.has(id)).map(lockOf).find((reason) => reason !== null) ?? null;

    return (
        <div className="space-y-4 p-5">
            {/* On a phone the levels take a line of their own under the name of the area. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 sm:flex-1">
                    <h3 className="text-base font-semibold">{area.label}</h3>
                    <p className="text-xs text-muted-foreground">
                        {countIn(area, held)} of {area.permissions.length} permissions{level === "custom" && ", picked one by one"}
                    </p>
                </div>
                <LevelPicker
                    area={area}
                    value={level}
                    onChange={(next) => onHeldChange(withLevel(area, held, next))}
                    blocked={lockedReason ? blocked : undefined}
                    className="w-full sm:w-auto"
                />
            </div>
            <p className="text-xs text-muted-foreground">{area.summary}</p>

            <ul className="divide-y border-y">
                {area.permissions.map((permission) => {
                    const id = `${idBase}-${permission.id}`;
                    const locked = lockOf(permission.id);
                    const needs = withNeeds ? (permission.needs ?? []).map((needed) => permissionInfo(needed)?.label).filter((label): label is string => Boolean(label)) : [];
                    return (
                        <li key={permission.id} className="flex gap-3 py-3">
                            <Checkbox
                                id={id}
                                checked={held.has(permission.id)}
                                disabled={locked !== null && !held.has(permission.id)}
                                onCheckedChange={(checked) =>
                                    onHeldChange(withNeeds ? withPermission(held, permission.id, checked === true) : toggleAlone(held, permission.id, checked === true))
                                }
                                className="mt-0.5"
                            />
                            <div className="min-w-0">
                                <Label htmlFor={id} className={cn("text-sm leading-snug font-medium", locked && "text-muted-foreground")}>{permission.label}</Label>
                                <p className="text-xs text-muted-foreground">{permission.description}</p>
                                {needs.length > 0 && !locked && <p className="mt-0.5 text-xs text-tone">Needs {listWords(needs)}, which is ticked with it</p>}
                                {locked && (
                                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Lock className="size-3 shrink-0" aria-hidden="true" />
                                        {locked}
                                    </p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>

            {note}
        </div>
    );
}
