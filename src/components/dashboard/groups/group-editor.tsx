"use client";

import { useId, useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { listed } from "@/components/dashboard/users/user-strip";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listWords } from "@/lib/auth/access-summary";
import { countIn, LEVEL_LABELS, levelOf, PERMISSION_AREAS, permissionInfo, withLevel, withPermission, type PermissionArea } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import { LevelPicker } from "./group-level-picker";

interface GroupEditorProps {
    name: string;
    onNameChange: (name: string) => void;
    nameError: string | null;
    held: ReadonlySet<string>;
    onHeldChange: (next: Set<string>) => void;
    /** The members who get every change, named under the permissions. */
    memberNames: string[];
}

/**
 * The permissions of a group, one area at a time: the areas with their level on the left, a
 * `Select` of them on a phone, and the open area with its level and every permission of it on the
 * right. The height stays the same from area to area, so the dialog does not jump.
 */
export function GroupEditor({ name, onNameChange, nameError, held, onHeldChange, memberNames }: GroupEditorProps) {
    const [active, setActive] = useState(PERMISSION_AREAS[0].id);
    const area = PERMISSION_AREAS.find((entry) => entry.id === active) ?? PERMISSION_AREAS[0];
    const nameId = useId();

    return (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15.5rem_minmax(0,1fr)] md:grid-rows-1">
            <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
                <div className="space-y-2 px-3 pt-4 pb-3">
                    <Label htmlFor={nameId}>Name</Label>
                    <Input
                        id={nameId}
                        value={name}
                        onChange={(event) => onNameChange(event.target.value)}
                        maxLength={100}
                        autoComplete="off"
                        placeholder="Like Operators"
                        aria-invalid={nameError ? true : undefined}
                        aria-describedby={nameError ? `${nameId}-message` : undefined}
                    />
                    {nameError && <p id={`${nameId}-message`} className="text-sm text-destructive">{nameError}</p>}
                </div>

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
                                    <span className={cn("shrink-0 text-xs font-normal", level === "none" ? "text-muted-foreground" : "text-foreground")}>{LEVEL_LABELS[level]}</span>
                                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                </button>
                            );
                        })}
                    </nav>
                </ScrollArea>
            </div>

            <ScrollArea className="min-h-0">
                <AreaPane area={area} held={held} onHeldChange={onHeldChange} memberNames={memberNames} />
            </ScrollArea>
        </div>
    );
}

interface AreaPaneProps {
    area: PermissionArea;
    held: ReadonlySet<string>;
    onHeldChange: (next: Set<string>) => void;
    memberNames: string[];
}

/** One area: its level, then every permission with a sentence and what it needs. */
function AreaPane({ area, held, onHeldChange, memberNames }: AreaPaneProps) {
    const idBase = useId();
    const level = levelOf(area, held);
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
                <LevelPicker area={area} value={level} onChange={(next) => onHeldChange(withLevel(area, held, next))} className="w-full sm:w-auto" />
            </div>
            <p className="text-xs text-muted-foreground">{area.summary}</p>

            <ul className="divide-y border-y">
                {area.permissions.map((permission) => {
                    const id = `${idBase}-${permission.id}`;
                    const needs = (permission.needs ?? []).map((needed) => permissionInfo(needed)?.label).filter((label): label is string => Boolean(label));
                    return (
                        <li key={permission.id} className="flex gap-3 py-3">
                            <Checkbox
                                id={id}
                                checked={held.has(permission.id)}
                                onCheckedChange={(checked) => onHeldChange(withPermission(held, permission.id, checked === true))}
                                className="mt-0.5"
                            />
                            <div className="min-w-0">
                                <Label htmlFor={id} className="text-sm leading-snug font-medium">{permission.label}</Label>
                                <p className="text-xs text-muted-foreground">{permission.description}</p>
                                {needs.length > 0 && <p className="mt-0.5 text-xs text-tone">Needs {listWords(needs)}, which is ticked with it</p>}
                            </div>
                        </li>
                    );
                })}
            </ul>

            {memberNames.length > 0 && (
                <div className="flex gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
                    <Users className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>
                        {listed(memberNames)} {memberNames.length === 1 ? "gets" : "get"} every change with their next click.
                    </span>
                </div>
            )}
        </div>
    );
}

