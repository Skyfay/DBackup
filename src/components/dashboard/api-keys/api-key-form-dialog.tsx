"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { createApiKey, updateApiKey } from "@/app/actions/auth/api-key";
import { TOTAL_PERMISSIONS } from "@/components/dashboard/groups/group-cells";
import { NameField } from "@/components/dashboard/groups/group-form-dialog";
import { PermissionEditor } from "@/components/permissions/permission-editor";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiKeyTemplate, type ApiKeyTemplate } from "@/lib/auth/api-key-templates";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { freeGroupName } from "@/lib/auth/group-templates";
import { areaChanges, describeChange, knownPermissions } from "@/lib/auth/permission-areas";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";
import { ApiKeyCreatedDialog, type CreatedKey } from "./api-key-created-dialog";
import { expiryOf, ExpiryField, type ExpiryChoice } from "./api-key-expiry-field";
import { ApiKeyStart, type ApiKeyStartChoice } from "./api-key-start";

const log = logger.child({ component: "api-key-form-dialog" });

export type ApiKeyFormMode = { kind: "create" } | { kind: "edit"; key: ApiKeyRow };

interface ApiKeyFormDialogProps {
    open: boolean;
    mode: ApiKeyFormMode;
    /** Every key, to copy one and to keep the names apart. */
    keys: ApiKeyRow[];
    /** What the viewer may do, the most a key they make or change may get. */
    viewerPermissions: readonly string[];
    onOpenChange: (open: boolean) => void;
    onSaved?: () => void;
    /** Opens the editor right away with a task and a name, like the Setup of the API trigger. */
    preset?: { templateId: ApiKeyTemplate["id"]; name: string };
    /** Gets the new key, instead of the dialog that shows it once, for a caller that shows it itself. */
    onCreated?: (created: CreatedKey) => void;
}

/**
 * New API key and Edit. New API key starts with the choice of a task, a copy or Custom as step 1
 * of 2, and every way ends in the same editor as the groups, with the name and when the key runs
 * out. A new key shows its secret once after that.
 */
export function ApiKeyFormDialog({ open, mode, keys, viewerPermissions, onOpenChange, onSaved, preset, onCreated }: ApiKeyFormDialogProps) {
    const [start, setStart] = useState<ApiKeyStartChoice | null>(null);
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState<CreatedKey | null>(null);

    const presetId = preset?.templateId;
    useEffect(() => {
        if (!open) return;
        const template = presetId ? apiKeyTemplate(presetId) : undefined;
        setStart(template ? { kind: "template", template } : null);
    }, [open, presetId]);

    const editing = mode.kind === "edit";
    const onEditor = editing || start !== null;
    const editorKey = editing
        ? `edit-${mode.key.id}`
        : start ? `${start.kind}-${start.kind === "template" ? start.template.id : start.kind === "copy" ? start.key.id : "custom"}` : "start";

    return (
        <>
            <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
                <DialogContent tone={editing ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, onEditor ? "h-[95dvh] sm:h-auto sm:max-w-4xl" : "sm:max-w-2xl")}>
                    {onEditor ? (
                        <EditorForm
                            key={editorKey}
                            mode={mode}
                            start={start}
                            presetName={preset?.name}
                            keys={keys}
                            viewerPermissions={viewerPermissions}
                            onBack={mode.kind === "create" && !preset ? () => setStart(null) : undefined}
                            onClose={() => onOpenChange(false)}
                            onSavingChange={setSaving}
                            onDone={(result) => {
                                onSaved?.();
                                if (result && onCreated) onCreated(result);
                                else if (result) setCreated(result);
                            }}
                        />
                    ) : (
                        <ApiKeyStart keys={keys} viewerPermissions={viewerPermissions} onPick={setStart} />
                    )}
                </DialogContent>
            </Dialog>
            {created && <ApiKeyCreatedDialog created={created} onClose={() => setCreated(null)} />}
        </>
    );
}

interface EditorFormProps {
    mode: ApiKeyFormMode;
    start: ApiKeyStartChoice | null;
    presetName?: string;
    keys: ApiKeyRow[];
    viewerPermissions: readonly string[];
    onBack?: () => void;
    onClose: () => void;
    onSavingChange: (saving: boolean) => void;
    /** A new key with its secret, or null after an edit. */
    onDone: (created: CreatedKey | null) => void;
}

/** What the editor starts with: the key itself, a task, a copy or nothing. */
function initialOf(mode: ApiKeyFormMode, start: ApiKeyStartChoice | null, taken: string[], viewer: ReadonlySet<string>, presetName?: string) {
    if (mode.kind === "edit") {
        const { key } = mode;
        return { name: key.name, permissions: key.permissions, choice: (key.expiresAt ? "date" : "never") as ExpiryChoice, date: key.expiresAt ? new Date(key.expiresAt) : null };
    }
    const fresh = { choice: "90d" as ExpiryChoice, date: null };
    if (start?.kind === "template") return { name: freeGroupName(presetName ?? start.template.keyName, taken), permissions: start.template.permissions, ...fresh };
    if (start?.kind === "copy") return { name: freeGroupName(`${start.key.name} copy`, taken), permissions: start.key.effective.filter((permission) => viewer.has(permission)), ...fresh };
    return { name: "", permissions: [] as string[], ...fresh };
}

/** The second step: the name, when the key runs out and its permissions. */
function EditorForm({ mode, start, presetName, keys, viewerPermissions, onBack, onClose, onSavingChange, onDone }: EditorFormProps) {
    const key = mode.kind === "edit" ? mode.key : null;
    const { formatDate } = useDateFormatter();
    const viewer = useMemo(() => new Set(viewerPermissions), [viewerPermissions]);
    const taken = useMemo(() => keys.filter((entry) => entry.id !== key?.id).map((entry) => entry.name), [keys, key]);
    const [initial] = useState(() => initialOf(mode, start, taken, viewer, presetName));
    const [name, setName] = useState(initial.name);
    const [held, setHeld] = useState<Set<string>>(() => new Set(knownPermissions(initial.permissions)));
    const [expiry, setExpiry] = useState<{ choice: ExpiryChoice; date: Date | null }>({ choice: initial.choice, date: initial.date });
    const [problem, setProblem] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // A key never gets more than the group of its owner may do, and nobody hands out more than they may do.
    const owner = key?.owner;
    const ownerAllows = useMemo(() => (key ? new Set(key.ownerPermissions) : viewer), [key, viewer]);
    const lockedReason = (permission: string) => {
        if (!ownerAllows.has(permission)) return key && !key.isMine ? `The group of ${owner?.name} may not, so the key may not either` : "Your group may not, so no key of yours may";
        if (!viewer.has(permission)) return "Your group may not, so you cannot give it to a key";
        return null;
    };

    const before = useMemo(() => new Set(knownPermissions(initial.permissions)), [initial]);
    const changes = useMemo(() => areaChanges(before, held), [before, held]);
    const renamed = key !== null && name.trim() !== key.name;
    const expiresAt = expiryOf(expiry.choice, expiry.date);
    // An untouched date is the stored one, a span counts from now and always changes it.
    const expiryChanged = key !== null && (expiresAt?.getTime() ?? null) !== (key.expiresAt ? Date.parse(key.expiresAt) : null);
    const unchanged = key !== null && !renamed && changes.length === 0 && !expiryChanged;
    const tone = key ? "edit" : "create";

    const runsOut = expiresAt ? `runs out ${formatDate(expiresAt, "P")}` : "never runs out";
    const summary = key
        ? unchanged
            ? "No changes yet"
            : ["Changed:", [...(renamed ? ["the name"] : []), ...(expiryChanged ? ["when it runs out"] : []), ...changes.map((change) => describeChange(change, before, held))].join(", ")].join(" ")
        : `${held.size} of ${TOTAL_PERMISSIONS} permissions · ${runsOut}`;

    const busy = (next: boolean) => {
        setSaving(next);
        onSavingChange(next);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return setProblem("Give the key a name.");
        // Runs name the key they came from by its name, so two keys never share one.
        if (taken.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return setProblem("A key by this name exists already.");
        if (held.size === 0) return setProblem("Give the key at least one permission.");
        if (unchanged) return onClose();

        busy(true);
        try {
            const fields = { name: trimmed, permissions: [...held], expiresAt: expiresAt?.toISOString() ?? null };
            if (key) {
                const result = await updateApiKey(key.id, fields);
                if (!result.success) {
                    toast.error(result.error || "The key could not be saved.");
                    busy(false);
                    return;
                }
                toast.success(`${trimmed} saved`);
                busy(false);
                onDone(null);
                onClose();
                return;
            }
            const result = await createApiKey({ ...fields, ...(start?.kind === "template" ? { template: start.template.id } : {}) });
            if (!result.success || !result.data) {
                toast.error(result.error || "The key could not be created.");
                busy(false);
                return;
            }
            busy(false);
            onDone({ name: trimmed, rawKey: result.data.rawKey, templateId: start?.kind === "template" ? start.template.id : null, permissions: fields.permissions });
            onClose();
        } catch (error) {
            // Without the right to change API keys the actions throw instead of answering.
            log.warn("Saving an API key failed", { apiKeyId: key?.id }, wrapError(error));
            toast.error("The key could not be saved.");
            busy(false);
        }
    };

    const note = key
        ? "A change applies to the next request of the key"
        : start?.kind === "template"
          ? `Starts as ${start.template.label}, it acts as you`
          : start?.kind === "copy"
            ? `Starts as a copy of ${start.key.name}, it acts as you`
            : "Starts with no permission, it acts as you";

    const ownerNote = key && !key.isMine
        ? `The key acts as ${owner?.name}. The group ${owner?.groupName ?? "of the owner"} decides the most it may get, and the locked ones are beyond it.`
        : "The key acts as you. It never gets more than your group may do, and loses what your group loses.";

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead
                tone={tone}
                icon={key ? Pencil : Plus}
                action={onBack && (
                    <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={saving}>
                        Change task
                    </Button>
                )}
            >
                <DialogTitle className="truncate text-base">{key ? `Edit ${key.name}` : "New API key"}</DialogTitle>
                <DialogDescription className={dialogNoteClass(tone)}>{note}</DialogDescription>
            </DialogHead>

            {/* A phone gives the editor all the height the head and the foot leave. From sm up it keeps one
                height, so switching areas does not make the dialog jump. */}
            <div className="flex min-h-0 flex-1 flex-col sm:h-[min(40rem,calc(95dvh-9.5rem))] sm:flex-none">
                <PermissionEditor
                    fields={
                        <>
                            <NameField
                                value={name}
                                onChange={(next) => {
                                    setName(next);
                                    setProblem(null);
                                }}
                                error={problem}
                                placeholder="Like Deploy pipeline"
                            />
                            <ExpiryField choice={expiry.choice} date={expiry.date} onChange={(choice, date) => setExpiry({ choice, date })} />
                        </>
                    }
                    held={held}
                    onHeldChange={(next) => {
                        setHeld(next);
                        setProblem(null);
                    }}
                    lockedReason={lockedReason}
                    withNeeds={false}
                    changedAreas={key ? new Set(changes.map((change) => change.area.id)) : undefined}
                    note={
                        <div className="flex gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
                            <UserRound className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span>{ownerNote}</span>
                        </div>
                    }
                />
            </div>

            {/* On a phone the summary takes a line of its own above the buttons. */}
            <div className={cn(DIALOG_FOOTER, "flex flex-col gap-2 sm:flex-row sm:items-center")}>
                <span className="min-w-0 truncate text-xs text-muted-foreground sm:mr-auto" title={summary}>
                    {!key && onBack ? `Step 2 of 2 · ${summary}` : summary}
                </span>
                <div className="flex shrink-0 items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" disabled={saving || unchanged}>
                        {saving && <Loader2 className="animate-spin" />}
                        {key ? "Save changes" : "Create key"}
                    </Button>
                </div>
            </div>
        </form>
    );
}
