"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe, Loader2, Lock, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { previewTenantGroupTemplate, saveTenantGroupTemplate, type TenantGroupPlan } from "@/app/actions/auth/tenant-group-template";
import { NameField } from "@/components/dashboard/groups/group-form-dialog";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogBackButton, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tone } from "@/components/ui/tone";
import { areaChanges, describeChange, TENANT_GROUP_AREAS } from "@/lib/auth/permission-areas";
import { lockedAllTenants, lockedTenant, lockedTenantRight, platformGroupRefusal } from "@/lib/auth/platform-group-caps";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { GroupRow, TenantGroupTemplateRow } from "@/services/user/groups-types";
import type { PlatformGroupsModel } from "@/services/user/platform-groups-types";
import type { ReachPlan, ReachPreview } from "@/services/user/tenant-group-templates";
import { WHERE } from "./platform-group-editor";
import { actorOf } from "./platform-group-form";
import type { ScopeValue } from "./platform-group-scope";
import { TenantGroupReachDialog } from "./tenant-group-reach-dialog";
import { TenantGroupTemplateEditor } from "./tenant-group-template-editor";
import { draftOf, ownByName, startName, templateRow, templateShape, type TenantGroupStart } from "./tenant-group-template-model";
import { TenantGroupTemplateStart } from "./tenant-group-template-start";

const log = logger.child({ component: "tenant-group-template-dialog" });

const BEYOND = "Read only, this group may do more than you may";

interface TenantGroupTemplateDialogProps {
    open: boolean;
    /** The group for tenants to edit, none for a new one. */
    template: TenantGroupTemplateRow | null;
    /** A new one starts as a copy of this one, from Duplicate, and skips the first step. */
    copyOf?: TenantGroupTemplateRow | null;
    /** Every group of every tenant, for the tenants that have one of their own by the name. */
    groups: readonly GroupRow[];
    /** The tenants and what the viewer may give, as the platform groups read them. */
    editor: PlatformGroupsModel;
    /** Every group for tenants, which a new one may start as a copy of. */
    templates: readonly TenantGroupTemplateRow[];
    /** The names of the other groups for tenants, which this one may not take. */
    taken: readonly string[];
    canManage: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete?: (template: TenantGroupTemplateRow) => void;
    onSaved: () => void;
}

/**
 * New group for tenants and Edit, one editor for both: the name, the tenants it reaches and the
 * permissions of a member in each. New starts with a preset for a common use of a tenant, a copy
 * or Custom as step 1 of 2. Save asks first what happens in a tenant that has a group of its own by
 * the name and in a tenant it leaves where people hold it. A group that may do more than the viewer
 * opens read only.
 */
export function TenantGroupTemplateDialog(props: TenantGroupTemplateDialogProps) {
    const { open, template, copyOf, templates, onOpenChange } = props;
    const [start, setStart] = useState<TenantGroupStart | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setStart(copyOf ? { kind: "copy", template: copyOf } : null);
    }, [open, copyOf]);

    const onEditor = template !== null || start !== null;
    const editorKey = template ? template.id : start?.kind === "template" ? `preset-${start.template.id}` : start?.kind === "copy" ? `copy-${start.template.id}` : "custom";
    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent tone={template ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, onEditor ? "h-[95dvh] sm:h-auto sm:max-w-4xl lg:max-w-6xl" : "sm:max-w-2xl")}>
                {open && (onEditor ? (
                    <EditorForm key={editorKey} {...props} start={start} onBack={template ? undefined : () => setStart(null)} onSavingChange={setSaving} />
                ) : (
                    <TenantGroupTemplateStart templates={templates} onPick={setStart} />
                ))}
            </DialogContent>
        </Dialog>
    );
}

interface EditorFormProps extends TenantGroupTemplateDialogProps {
    start: TenantGroupStart | null;
    onBack?: () => void;
    onSavingChange: (saving: boolean) => void;
}

function EditorForm({ template, start, groups, editor, taken, canManage, onOpenChange, onBack, onDelete, onSaved, onSavingChange }: EditorFormProps) {
    const actor = useMemo(() => actorOf(editor.viewer), [editor]);
    const initial = useMemo(() => draftOf(template, start, actor, taken), [template, start, actor, taken]);
    const readOnly = !canManage || (template !== null && platformGroupRefusal(actor, templateShape({ ...template, tenantIds: template.groups.map((group) => group.tenantId) })) !== null);
    const tone: Tone = readOnly ? "neutral" : template ? "edit" : "create";
    const [name, setName] = useState(initial.name);
    const [held, setHeld] = useState<Set<string>>(() => new Set(initial.held));
    const [scope, setScope] = useState<ScopeValue>(initial.scope);
    const [problem, setProblem] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [asking, setAsking] = useState<ReachPreview | null>(null);

    const own = useMemo(() => ownByName(groups, name), [groups, name]);
    const linked = useMemo(() => new Set(template?.groups.map((group) => group.tenantId) ?? []), [template]);
    const reached = scope.allTenants ? editor.tenants.length : scope.tenantIds.length;
    const changed = useMemo(() => {
        const areas = areaChanges(new Set(initial.held), held, TENANT_GROUP_AREAS).map((change) => change.area.id);
        const sameScope = scope.allTenants === initial.scope.allTenants && (scope.allTenants || (scope.tenantIds.length === initial.scope.tenantIds.length && scope.tenantIds.every((id) => initial.scope.tenantIds.includes(id))));
        return new Set([...areas, ...(sameScope ? [] : [WHERE])]);
    }, [initial, held, scope]);
    const unchanged = template !== null && name.trim() === template.name && changed.size === 0;
    const members = template ? templateRow(template).members.length : 0;

    const busy = (next: boolean) => {
        setSaving(next);
        onSavingChange(next);
    };

    const values = () => ({ name: name.trim(), permissions: [...held], allTenants: scope.allTenants, tenantIds: scope.tenantIds });

    const save = async (plan: ReachPlan) => {
        busy(true);
        try {
            const result = await saveTenantGroupTemplate(template?.id ?? null, values(), plan as TenantGroupPlan);
            if (!result.success) {
                toast.error(result.error || "The group could not be saved.");
                return;
            }
            const left = result.data.report.leftOut.length;
            toast.success(template ? `${values().name} saved` : `${values().name} created`, left > 0 ? { description: `${left} ${left === 1 ? "tenant was" : "tenants were"} left out, they keep their own.` } : undefined);
            setAsking(null);
            onSaved();
            onOpenChange(false);
        } catch (error: unknown) {
            log.warn("Saving a group for tenants failed", { templateId: template?.id }, wrapError(error));
            toast.error("The group could not be saved.");
        } finally {
            busy(false);
        }
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (readOnly) return onOpenChange(false);
        const trimmed = name.trim();
        if (!trimmed) return setProblem("Give the group a name.");
        if (trimmed.toLowerCase() === "admin") return setProblem("Admin is the group with every permission in each tenant.");
        if (taken.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return setProblem("A group for tenants by this name exists already.");
        if (unchanged) return onOpenChange(false);

        busy(true);
        try {
            const result = await previewTenantGroupTemplate(template?.id ?? null, values());
            if (!result.success) {
                toast.error(result.error || "The group could not be checked.");
                busy(false);
                return;
            }
            const needs = result.data.clashes.length > 0 || result.data.leaving.some((entry) => entry.members.length > 0);
            busy(false);
            if (needs) setAsking(result.data);
            else await save({});
        } catch (error: unknown) {
            log.warn("Checking a group for tenants failed", { templateId: template?.id }, wrapError(error));
            toast.error("The group could not be checked.");
            busy(false);
        }
    };

    const note = readOnly
        ? (canManage ? "Read only, it may do more than you may" : "Read only")
        : template
          ? `A change counts at once in ${template.groups.length === 1 ? "its tenant" : `its ${template.groups.length} tenants`}`
          : `Starts as ${startName(start)}, one group in every tenant it reaches${initial.trimmed ? ", without what you may not give" : ""}`;
    const summary = template
        ? (changed.size === 0 && name.trim() === template.name ? "No changes yet" : `Changed: ${[
            ...(name.trim() !== template.name ? ["the name"] : []),
            ...areaChanges(new Set(initial.held), held, TENANT_GROUP_AREAS).map((change) => describeChange(change, new Set(initial.held), held)),
            ...(changed.has(WHERE) ? ["Where"] : []),
        ].join(", ")}`)
        : `${TENANT_GROUP_AREAS.filter((area) => area.permissions.some((permission) => held.has(permission.id))).length} areas in ${reached} ${reached === 1 ? "tenant" : "tenants"}`;

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead
                tone={tone}
                icon={readOnly ? Globe : template ? Pencil : Plus}
                action={onBack && (
                    <DialogBackButton onClick={onBack} disabled={saving}>
                        Change start
                    </DialogBackButton>
                )}
            >
                <DialogTitle className="truncate text-base">{readOnly ? template?.name : template ? `Edit ${template.name}` : "New group for tenants"}</DialogTitle>
                <DialogDescription className={dialogNoteClass(tone)}>{note}</DialogDescription>
            </DialogHead>

            <div className="flex min-h-0 flex-1 flex-col sm:h-[min(42rem,calc(95dvh-9.5rem))] sm:flex-none">
                <TenantGroupTemplateEditor
                    fields={readOnly ? <ReadOnlyName value={name} /> : (
                        <NameField
                            value={name}
                            onChange={(next) => {
                                setName(next);
                                setProblem(null);
                            }}
                            error={problem}
                            placeholder="Like Client"
                        />
                    )}
                    name={name}
                    held={held}
                    onHeldChange={setHeld}
                    scope={scope}
                    onScopeChange={setScope}
                    tenants={editor.tenants}
                    lock={(permission) => lockedTenantRight(actor, permission)}
                    allLock={lockedAllTenants(actor)}
                    tenantLock={(tenantId) => lockedTenant(actor, tenantId)}
                    aside={(tenantId) => (own.has(tenantId) && !linked.has(tenantId) ? (
                        <span className="flex shrink-0 items-center gap-1 rounded-sm bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
                            <TriangleAlert className="size-3" aria-hidden="true" />
                            Has a {name.trim()} of its own
                        </span>
                    ) : null)}
                    changed={template && !readOnly ? changed : undefined}
                    members={members}
                    readOnly={readOnly ? BEYOND : undefined}
                />
            </div>

            <div className={cn(DIALOG_FOOTER, "flex flex-col gap-2 sm:flex-row sm:items-center")}>
                {template && onDelete && !readOnly && (
                    <Button type="button" variant="ghost-destructive" onClick={() => onDelete(template)} disabled={saving}>
                        <Trash2 />
                        Delete
                    </Button>
                )}
                <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground sm:mr-auto" title={summary}>
                    {readOnly && <Lock className="size-3.5 shrink-0" aria-hidden="true" />}
                    {readOnly ? "Read only" : template ? summary : `Step 2 of 2 · ${summary}`}
                </span>
                <div className="flex shrink-0 items-center justify-end gap-2">
                    {readOnly ? (
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                    ) : (
                        <>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                            <Button type="submit" disabled={saving || unchanged}>
                                {saving ? <Loader2 className="animate-spin" /> : !template && <Plus />}
                                {template ? "Save changes" : "Create group"}
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {asking && (
                <TenantGroupReachDialog
                    name={name.trim()}
                    preview={asking}
                    confirmLabel={template ? "Save changes" : "Create group"}
                    pending={saving}
                    onBack={() => setAsking(null)}
                    onConfirm={(plan) => void save(plan)}
                />
            )}
        </form>
    );
}

/** The name of a group shown read only, with a lock in the field. */
function ReadOnlyName({ value }: { value: string }) {
    return (
        <div className="space-y-2">
            <Label htmlFor="tenant-group-template-name">Name</Label>
            <div className="relative">
                <Input id="tenant-group-template-name" value={value} readOnly className="pr-8" />
                <Lock className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>
        </div>
    );
}
