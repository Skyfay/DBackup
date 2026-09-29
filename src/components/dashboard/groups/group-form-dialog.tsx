"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createGroup, updateGroup } from "@/app/actions/auth/group";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { freeGroupName } from "@/lib/auth/group-templates";
import { areaChanges, describeChange, knownPermissions } from "@/lib/auth/permission-areas";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { GroupRow } from "@/services/user/groups-types";
import { TOTAL_PERMISSIONS } from "./group-cells";
import { GroupEditor } from "./group-editor";
import { GroupStart, type GroupStartChoice } from "./group-start";

const log = logger.child({ component: "group-form-dialog" });

export type GroupFormMode = { kind: "create" } | { kind: "edit"; group: GroupRow } | { kind: "duplicate"; group: GroupRow };

interface GroupFormDialogProps {
    open: boolean;
    mode: GroupFormMode;
    /** Every group, to copy one and to keep the names apart. */
    groups: GroupRow[];
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

/**
 * New group, Duplicate and Edit. New group starts with the choice of a template, a copy or
 * Custom as step 1 of 2, and every way ends in the same editor, which Duplicate and Edit open
 * right away.
 */
export function GroupFormDialog({ open, mode, groups, onOpenChange, onSaved }: GroupFormDialogProps) {
    const [start, setStart] = useState<GroupStartChoice | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setStart(mode.kind === "duplicate" ? { kind: "copy", group: mode.group } : null);
    }, [open, mode]);

    const editing = mode.kind === "edit";
    const onEditor = editing || start !== null;
    // A new pick starts a fresh editor, the same pick keeps what was typed.
    const editorKey = editing ? `edit-${mode.group.id}` : start ? `${start.kind}-${start.kind === "template" ? start.template.id : start.kind === "copy" ? start.group.id : "custom"}` : "start";

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent tone={editing ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, onEditor ? "h-[95dvh] sm:h-auto sm:max-w-4xl" : "sm:max-w-2xl")}>
                {onEditor ? (
                    <EditorForm
                        key={editorKey}
                        mode={mode}
                        start={start}
                        groups={groups}
                        onBack={mode.kind === "create" ? () => setStart(null) : undefined}
                        onClose={() => onOpenChange(false)}
                        onSaved={onSaved}
                        onSavingChange={setSaving}
                    />
                ) : (
                    <GroupStart groups={groups} onPick={setStart} />
                )}
            </DialogContent>
        </Dialog>
    );
}

interface EditorFormProps {
    mode: GroupFormMode;
    start: GroupStartChoice | null;
    groups: GroupRow[];
    onBack?: () => void;
    onClose: () => void;
    onSaved: () => void;
    onSavingChange: (saving: boolean) => void;
}

/** What the editor starts with: the group itself, a template, a copy or nothing. */
function initialOf(mode: GroupFormMode, start: GroupStartChoice | null, taken: string[]) {
    if (mode.kind === "edit") return { name: mode.group.name, permissions: mode.group.permissions };
    if (start?.kind === "template") return { name: freeGroupName(start.template.groupName, taken), permissions: start.template.permissions };
    if (start?.kind === "copy") {
        const permissions = start.group.superAdmin ? AVAILABLE_PERMISSIONS.map((permission) => permission.id) : start.group.permissions;
        return { name: freeGroupName(`${start.group.name} copy`, taken), permissions };
    }
    return { name: "", permissions: [] as string[] };
}

/** The second step: the name and the permissions, saved as a new group or into the one being edited. */
function EditorForm({ mode, start, groups, onBack, onClose, onSaved, onSavingChange }: EditorFormProps) {
    const group = mode.kind === "edit" ? mode.group : null;
    const taken = useMemo(() => groups.filter((entry) => entry.id !== group?.id).map((entry) => entry.name), [groups, group]);
    const initial = useMemo(() => initialOf(mode, start, taken), [mode, start, taken]);
    const [name, setName] = useState(initial.name);
    const [held, setHeld] = useState<Set<string>>(() => new Set(knownPermissions(initial.permissions)));
    const [problem, setProblem] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const before = useMemo(() => new Set(knownPermissions(initial.permissions)), [initial]);
    const changes = useMemo(() => areaChanges(before, held), [before, held]);
    const renamed = group !== null && name.trim() !== group.name;
    const unchanged = group !== null && !renamed && changes.length === 0;
    const tone = group ? "edit" : "create";
    const members = group?.members ?? [];

    const summary = group
        ? unchanged
            ? "No changes yet"
            : ["Changed:", [...(renamed ? ["the name"] : []), ...changes.map((change) => describeChange(change, before, held))].join(", ")].join(" ")
        : `${held.size} of ${TOTAL_PERMISSIONS} permissions`;

    const busy = (next: boolean) => {
        setSaving(next);
        onSavingChange(next);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return setProblem("Give the group a name.");
        if (taken.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return setProblem("A group by this name exists already.");
        if (unchanged) return onClose();

        busy(true);
        try {
            const permissions = [...held];
            const result = group
                ? await updateGroup(group.id, { name: trimmed, permissions })
                : await createGroup({ name: trimmed, permissions, ...(start?.kind === "template" ? { template: start.template.id } : {}) });
            if (result.success) {
                toast.success(group ? `${trimmed} saved` : `${trimmed} created`);
                busy(false);
                onSaved();
                onClose();
                return;
            }
            toast.error(result.error || "The group could not be saved.");
        } catch (error) {
            // Without the right to change groups the actions throw instead of answering.
            log.warn("Saving a group failed", { groupId: group?.id }, wrapError(error));
            toast.error("The group could not be saved.");
        }
        busy(false);
    };

    const note = group
        ? members.length > 0
            ? `A change applies to its ${members.length === 1 ? "member" : `${members.length} members`} at once`
            : "Nobody is in it yet"
        : start?.kind === "template"
          ? `Starts as ${start.template.label}, with nobody in it`
          : start?.kind === "copy"
            ? `Starts as a copy of ${start.group.name}, with nobody in it`
            : "Starts with no permission and nobody in it";

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead
                tone={tone}
                icon={group ? Pencil : Plus}
                action={onBack && (
                    <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={saving}>
                        Change start
                    </Button>
                )}
            >
                <DialogTitle className="truncate text-base">{group ? `Edit ${group.name}` : "New group"}</DialogTitle>
                <DialogDescription className={dialogNoteClass(tone)}>{note}</DialogDescription>
            </DialogHead>

            {/* A phone gives the editor all the height the head and the foot leave. From sm up it keeps one
                height, so switching areas does not make the dialog jump. */}
            <div className="flex min-h-0 flex-1 flex-col sm:h-[min(38rem,calc(95dvh-9.5rem))] sm:flex-none">
                <GroupEditor
                    name={name}
                    onNameChange={(next) => {
                        setName(next);
                        setProblem(null);
                    }}
                    nameError={problem}
                    held={held}
                    onHeldChange={setHeld}
                    memberNames={members.map((member) => member.name)}
                />
            </div>

            {/* On a phone the summary takes a line of its own above the buttons. */}
            <div className={cn(DIALOG_FOOTER, "flex flex-col gap-2 sm:flex-row sm:items-center")}>
                <span className="min-w-0 truncate text-xs text-muted-foreground sm:mr-auto" title={summary}>
                    {!group && onBack ? `Step 2 of 2 · ${summary}` : summary}
                </span>
                <div className="flex shrink-0 items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" disabled={saving || unchanged}>
                        {saving && <Loader2 className="animate-spin" />}
                        {group ? "Save changes" : "Create group"}
                    </Button>
                </div>
            </div>
        </form>
    );
}
