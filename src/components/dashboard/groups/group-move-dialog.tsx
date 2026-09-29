"use client";

import { useId, useMemo, useState } from "react";
import { ArrowRight, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { moveUsersToGroup } from "@/app/actions/auth/group";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { GroupTag } from "@/components/dashboard/users/user-cells";
import { NO_GROUP } from "@/components/dashboard/users/user-columns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BulkResult } from "@/lib/core/bulk";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { GroupMember, GroupPerson, GroupRow } from "@/services/user/groups-types";
import { countWord } from "./group-cells";
import { groupTargets } from "./group-delete-dialog";

const log = logger.child({ component: "group-move-dialog" });

export type GroupMoveTask = { kind: "member"; group: GroupRow; member: GroupMember } | { kind: "add"; group: GroupRow };

interface GroupMoveDialogProps {
    task: GroupMoveTask;
    groups: GroupRow[];
    /** Everyone who signs in, for Add people. */
    people: GroupPerson[];
    viewerSuperAdmin: boolean;
    onClose: () => void;
    onDone: () => void;
}

/** Tells what a move did, and why a person stayed where they were. */
function report(result: BulkResult) {
    if (result.succeeded.length > 0) toast.success(`${countWord(result.succeeded.length, "person", "people")} moved`);
    for (const failure of result.failed) toast.error(`${failure.name ?? "Someone"}: ${failure.error}`);
}

/**
 * Moves people between groups from the panel of a group: one member to another group, or several
 * people into this one. Both change the users, so both need the right to change users.
 */
export function GroupMoveDialog({ task, groups, people, viewerSuperAdmin, onClose, onDone }: GroupMoveDialogProps) {
    const [pending, setPending] = useState(false);
    const [target, setTarget] = useState("");
    const [picked, setPicked] = useState<Set<string>>(new Set());

    const run = async () => {
        const ids = task.kind === "member" ? [task.member.id] : [...picked];
        const groupId = task.kind === "member" ? (target === NO_GROUP ? null : target) : task.group.id;
        setPending(true);
        try {
            const result = await moveUsersToGroup(ids, groupId);
            if (result.success) {
                report(result.data);
                onDone();
                return;
            }
            toast.error(result.error || "The people could not be moved.");
        } catch (error) {
            // Without the right to change users the action throws instead of answering.
            log.warn("Moving people failed", { groupId: task.group.id }, wrapError(error));
            toast.error("The people could not be moved.");
        }
        setPending(false);
    };

    const ready = task.kind === "member" ? target !== "" : picked.size > 0;
    const title = task.kind === "member" ? `Move ${task.member.name}` : `Add people to ${task.group.name}`;
    const note = task.kind === "member" ? `Out of ${task.group.name}, with the access of the new group` : "They move over from the group they are in";

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <DialogHead tone="edit" icon={task.kind === "member" ? ArrowRight : UserPlus}>
                    <DialogTitle className="truncate text-base">{title}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>{note}</DialogDescription>
                </DialogHead>

                {task.kind === "member" ? (
                    <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-10rem)]">
                        <div className="p-5">
                            <ChoiceCards value={target} onValueChange={setTarget} options={groupTargets(groups, task.group.id, viewerSuperAdmin)} aria-label="The group to move to" />
                        </div>
                    </ScrollArea>
                ) : (
                    <PeoplePicker group={task.group} groups={groups} people={people} viewerSuperAdmin={viewerSuperAdmin} picked={picked} onPickedChange={setPicked} />
                )}

                <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                    {task.kind === "add" && <span className="mr-auto text-xs text-muted-foreground">{countWord(picked.size, "person", "people")} picked</span>}
                    <DialogClose asChild>
                        <Button type="button" variant="ghost" disabled={pending}>Cancel</Button>
                    </DialogClose>
                    <Button type="button" onClick={() => void run()} disabled={pending || !ready}>
                        {pending && <Loader2 className="animate-spin" />}
                        {task.kind === "member" ? "Move" : picked.size > 0 ? `Move ${countWord(picked.size, "person", "people")} here` : "Move here"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface PeoplePickerProps {
    group: GroupRow;
    groups: GroupRow[];
    people: GroupPerson[];
    viewerSuperAdmin: boolean;
    picked: Set<string>;
    onPickedChange: (next: Set<string>) => void;
}

/** Why someone cannot be moved from here, or null. */
function blocker(person: GroupPerson, viewerSuperAdmin: boolean): string | null {
    if (person.isYou) return "You";
    if (person.superAdmin && !viewerSuperAdmin) return "Only a SuperAdmin moves a SuperAdmin";
    return null;
}

/** The people outside the group, with a search, a checkbox for all the search shows and their current group. */
function PeoplePicker({ group, groups, people, viewerSuperAdmin, picked, onPickedChange }: PeoplePickerProps) {
    const [search, setSearch] = useState("");
    const idBase = useId();
    const names = useMemo(() => new Map(groups.map((entry) => [entry.id, entry.name])), [groups]);
    const outside = people.filter((person) => person.groupId !== group.id);
    const term = search.trim().toLowerCase();
    const shown = term ? outside.filter((person) => person.name.toLowerCase().includes(term) || person.email.toLowerCase().includes(term)) : outside;
    const pickable = shown.filter((person) => !blocker(person, viewerSuperAdmin));
    const all = pickable.length > 0 && pickable.every((person) => picked.has(person.id));
    const some = pickable.some((person) => picked.has(person.id));

    const toggle = (ids: string[], on: boolean) => {
        const next = new Set(picked);
        for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
        }
        onPickedChange(next);
    };

    if (outside.length === 0) {
        return <p className="p-5 text-sm text-muted-foreground">Everyone is in {group.name} already.</p>;
    }

    return (
        <div className="space-y-3 p-5">
            <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input placeholder="Search people" aria-label="Search people" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" />
            </div>
            <div className="rounded-lg border">
                <label className="flex items-center gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(checked) => toggle(pickable.map((person) => person.id), checked === true)} disabled={pickable.length === 0} />
                    {term ? `All ${shown.length} the search shows` : `Everyone outside ${group.name}`}
                </label>
                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[min(20rem,calc(95dvh-18rem))]">
                    <ul className="divide-y">
                        {shown.map((person) => {
                            const reason = blocker(person, viewerSuperAdmin);
                            const id = `${idBase}-${person.id}`;
                            return (
                                <li key={person.id} className={cn("flex min-w-0 items-center gap-3 px-3 py-2", reason && "opacity-60")}>
                                    <Checkbox id={id} checked={picked.has(person.id)} onCheckedChange={(checked) => toggle([person.id], checked === true)} disabled={reason !== null} />
                                    <label htmlFor={id} className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{person.name}</span>
                                        <span className="block truncate text-xs text-muted-foreground">{reason ?? person.email}</span>
                                    </label>
                                    <GroupTag group={person.groupId ? { id: person.groupId, name: names.get(person.groupId) ?? "Another group" } : null} />
                                </li>
                            );
                        })}
                        {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">Nobody matches your search.</li>}
                    </ul>
                </ScrollArea>
            </div>
        </div>
    );
}
