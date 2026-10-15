"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Globe, Loader2, Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createPlatformGroup, updatePlatformGroup } from "@/app/actions/auth/platform-group";
import { NameField } from "@/components/dashboard/groups/group-form-dialog";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogBackButton, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tone } from "@/components/ui/tone";
import { lockedAllTenants, lockedPlatformRight, lockedTenant, lockedTenantRight } from "@/lib/auth/platform-group-caps";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { PlatformGroupRow, PlatformGroupsModel } from "@/services/user/platform-groups-types";
import { PlatformGroupEditor } from "./platform-group-editor";
import { actorOf, changedAreas, changeLine, createLine, draftOf, editableBy, type PlatformGroupFormMode } from "./platform-group-form";
import type { ScopeValue } from "./platform-group-scope";
import { PlatformGroupStart, type PlatformGroupStartChoice } from "./platform-group-start";

const log = logger.child({ component: "platform-group-dialog" });

/** Under every right of a group shown read only. */
const BUILT_IN = "Built in, Platform admin always holds it";
const BEYOND = "Read only, this group may do more than you may";

interface PlatformGroupDialogProps {
    open: boolean;
    mode: PlatformGroupFormMode;
    model: PlatformGroupsModel;
    /** May make and change platform groups. Without it every group opens read only. */
    canManage: boolean;
    onOpenChange: (open: boolean) => void;
    /** Opens a copy of a group shown read only, like Duplicate as a new group of Platform admin. */
    onDuplicate: (group: PlatformGroupRow) => void;
    onSaved: () => void;
}

/**
 * New platform group, Duplicate, Edit and the view of one the viewer may not change, Platform admin
 * included. New starts with Custom or a copy as step 1 of 2, every way ends in the same editor.
 */
export function PlatformGroupDialog({ open, mode, model, canManage, onOpenChange, onDuplicate, onSaved }: PlatformGroupDialogProps) {
    const [start, setStart] = useState<PlatformGroupStartChoice | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setStart(mode.kind === "duplicate" ? { kind: "copy", group: mode.group } : null);
    }, [open, mode]);

    const editing = mode.kind === "edit";
    const readOnly = editing && (!canManage || !editableBy(mode.group, model.viewer));
    const tone: Tone = readOnly ? "neutral" : editing ? "edit" : "create";
    const onEditor = editing || start !== null;
    const editorKey = editing ? `edit-${mode.group.id}` : start?.kind === "copy" ? `copy-${start.group.id}` : start ? "custom" : "start";

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent tone={tone} showCloseButton={false} className={cn(DIALOG_SURFACE, onEditor ? "h-[95dvh] sm:h-auto sm:max-w-4xl lg:max-w-6xl" : "sm:max-w-2xl")}>
                {onEditor ? (
                    <EditorForm
                        key={editorKey}
                        mode={mode}
                        copy={start?.kind === "copy" ? start.group : null}
                        model={model}
                        readOnly={readOnly}
                        tone={tone}
                        onBack={mode.kind === "create" ? () => setStart(null) : undefined}
                        onClose={() => onOpenChange(false)}
                        onDuplicate={canManage ? onDuplicate : undefined}
                        onSaved={onSaved}
                        onSavingChange={setSaving}
                    />
                ) : (
                    <PlatformGroupStart groups={model.groups} onPick={setStart} />
                )}
            </DialogContent>
        </Dialog>
    );
}

interface EditorFormProps {
    mode: PlatformGroupFormMode;
    copy: PlatformGroupRow | null;
    model: PlatformGroupsModel;
    readOnly: boolean;
    tone: Tone;
    onBack?: () => void;
    onClose: () => void;
    onDuplicate?: (group: PlatformGroupRow) => void;
    onSaved: () => void;
    onSavingChange: (saving: boolean) => void;
}

/** The second step: the name, the rights on the platform, Where and the rights in the tenants, saved as a new group or into the one edited. */
function EditorForm({ mode, copy, model, readOnly, tone, onBack, onClose, onDuplicate, onSaved, onSavingChange }: EditorFormProps) {
    const group = mode.kind === "edit" ? mode.group : null;
    const builtIn = group?.builtIn ?? false;
    const taken = useMemo(() => model.groups.filter((entry) => entry.id !== group?.id).map((entry) => entry.name), [model, group]);
    const initial = useMemo(() => draftOf(mode, copy, model.viewer, taken), [mode, copy, model, taken]);
    const actor = useMemo(() => actorOf(model.viewer), [model]);
    const [name, setName] = useState(initial.name);
    const [platform, setPlatform] = useState<Set<string>>(() => new Set(initial.platform));
    const [tenant, setTenant] = useState<Set<string>>(() => new Set(initial.tenant));
    const [scope, setScope] = useState<ScopeValue>(initial.scope);
    const [problem, setProblem] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const changed = useMemo(() => new Set(changedAreas(initial, platform, tenant, scope)), [initial, platform, tenant, scope]);
    const unchanged = group !== null && name.trim() === group.name && changed.size === 0;
    const summary = readOnly ? null : group ? changeLine(initial, name, platform, tenant, scope) : createLine(platform, tenant, scope);
    const members = group?.members ?? [];

    const busy = (next: boolean) => {
        setSaving(next);
        onSavingChange(next);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (readOnly) return onClose();
        const trimmed = name.trim();
        if (!trimmed) return setProblem("Give the platform group a name.");
        if ([...taken, "Platform admin"].some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return setProblem("A platform group by this name exists already.");
        if (unchanged) return onClose();

        busy(true);
        try {
            const values = { name: trimmed, platformPermissions: [...platform], tenantPermissions: [...tenant], allTenants: scope.allTenants, tenantIds: scope.tenantIds };
            const result = group ? await updatePlatformGroup(group.id, values) : await createPlatformGroup(values);
            if (result.success) {
                toast.success(group ? `${trimmed} saved` : `${trimmed} created`);
                busy(false);
                onSaved();
                onClose();
                return;
            }
            toast.error(result.error || "The platform group could not be saved.");
        } catch (error: unknown) {
            // Without the right to manage the accounts of the platform the actions throw instead of answering.
            log.warn("Saving a platform group failed", { groupId: group?.id }, wrapError(error));
            toast.error("The platform group could not be saved.");
        }
        busy(false);
    };

    const note = builtIn
        ? "Built in. Holds every right, nobody changes or deletes it"
        : readOnly
          ? "Read only, it may do more than you may or you are in it"
          : group
            ? `A change applies at once to its ${members.length === 1 ? "member" : `${members.length} members`}, in every tenant of its scope`
            : `Starts as ${copy ? `a copy of ${copy.name}` : "Custom"}, with nobody in it${initial.trimmed ? ", without what you may not give" : ""}`;

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead
                tone={tone}
                icon={builtIn ? Lock : readOnly ? Globe : group ? Pencil : Plus}
                action={onBack && (
                    <DialogBackButton onClick={onBack} disabled={saving}>
                        Change start
                    </DialogBackButton>
                )}
            >
                <DialogTitle className="truncate text-base">{readOnly ? group?.name : group ? `Edit ${group.name}` : "New platform group"}</DialogTitle>
                <DialogDescription className={dialogNoteClass(tone)}>{note}</DialogDescription>
            </DialogHead>

            <div className="flex min-h-0 flex-1 flex-col sm:h-[min(42rem,calc(95dvh-9.5rem))] sm:flex-none">
                <PlatformGroupEditor
                    fields={readOnly ? <ReadOnlyName value={name} /> : (
                        <NameField
                            value={name}
                            onChange={(next) => {
                                setName(next);
                                setProblem(null);
                            }}
                            error={problem}
                            placeholder="Like Support"
                        />
                    )}
                    name={name}
                    platform={platform}
                    onPlatformChange={setPlatform}
                    tenant={tenant}
                    onTenantChange={setTenant}
                    scope={scope}
                    onScopeChange={setScope}
                    tenants={model.tenants}
                    platformLock={(permission) => lockedPlatformRight(actor, permission)}
                    tenantLock={(permission) => lockedTenantRight(actor, permission)}
                    allLock={lockedAllTenants(actor)}
                    tenantScopeLock={(tenantId) => lockedTenant(actor, tenantId)}
                    changed={group && !readOnly ? changed : undefined}
                    members={members}
                    builtIn={builtIn}
                    readOnly={builtIn ? BUILT_IN : readOnly ? BEYOND : undefined}
                />
            </div>

            <div className={cn(DIALOG_FOOTER, "flex flex-col gap-2 sm:flex-row sm:items-center")}>
                <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground sm:mr-auto" title={summary ?? undefined}>
                    {readOnly && <Lock className="size-3.5 shrink-0" aria-hidden="true" />}
                    {readOnly ? (builtIn ? "Built in, read only" : "Read only") : !group && onBack ? `Step 2 of 2 · ${summary}` : summary}
                </span>
                <div className="flex shrink-0 items-center justify-end gap-2">
                    {readOnly ? (
                        <>
                            {onDuplicate && group && (
                                <Button type="button" variant="outline" onClick={() => onDuplicate(group)}>
                                    <Copy />
                                    Duplicate as a new group
                                </Button>
                            )}
                            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
                        </>
                    ) : (
                        <>
                            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                            <Button type="submit" disabled={saving || unchanged}>
                                {saving ? <Loader2 className="animate-spin" /> : !group && <Plus />}
                                {group ? "Save changes" : "Create group"}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </form>
    );
}

/** The name of a group shown read only, with a lock in the field. */
function ReadOnlyName({ value }: { value: string }) {
    return (
        <div className="space-y-2">
            <Label htmlFor="platform-group-name">Name</Label>
            <div className="relative">
                <Input id="platform-group-name" value={value} readOnly className="pr-8" />
                <Lock className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>
        </div>
    );
}
