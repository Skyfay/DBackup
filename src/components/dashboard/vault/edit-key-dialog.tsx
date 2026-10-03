"use client";

import { useId, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateEncryptionProfile } from "@/app/actions/backup/encryption";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { VaultKey } from "@/services/vault/vault-types";
import { ActorText } from "./credential-details";
import { KeyIdText } from "./vault-cells";
import { keyUse } from "./vault-format";

const log = logger.child({ component: "edit-key-dialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]";

interface EditKeyDialogProps {
    keyRow: VaultKey;
    /** The names of the other keys, which this one cannot take. */
    taken: string[];
    onClose: () => void;
    onSaved: () => void;
}

/** Renames a key and changes its description. The key itself never changes. */
export function EditKeyDialog({ keyRow, taken, onClose, onSaved }: EditKeyDialogProps) {
    const [name, setName] = useState(keyRow.name);
    const [description, setDescription] = useState(keyRow.description ?? "");
    const [problem, setProblem] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const nameId = useId();
    const descriptionId = useId();

    const trimmed = name.trim();
    const renamed = trimmed.length > 0 && trimmed !== keyRow.name;
    const changed = trimmed !== keyRow.name || description.trim() !== (keyRow.description ?? "");

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!trimmed) return setProblem("Give the key a name.");
        if (renamed && taken.includes(trimmed)) return setProblem("The Vault holds a key by this name already.");
        if (!changed) return onClose();
        setSaving(true);
        try {
            const result = await updateEncryptionProfile(keyRow.id, { name: trimmed, description: description.trim() || null });
            if (result.success) {
                toast.success("Key saved");
                onSaved();
                return;
            }
            toast.error(result.error || "The key could not be saved.");
        } catch (error) {
            // Without the right to write to the Vault the action throws instead of answering.
            log.warn("Saving a key failed", { profileId: keyRow.id }, wrapError(error));
            toast.error("The key could not be saved.");
        }
        setSaving(false);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={DIALOG_SURFACE}>
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                    <DialogHead tone="edit" icon={Pencil}>
                        <DialogTitle className="truncate text-base">Edit {keyRow.name}</DialogTitle>
                        <DialogDescription className={dialogNoteClass("edit")}>The name and the description</DialogDescription>
                    </DialogHead>

                    <ScrollArea className={BODY_SCROLL}>
                        <div className="space-y-5 p-5">
                            <div className="space-y-2">
                                <Label htmlFor={nameId}>Name</Label>
                                <Input
                                    id={nameId}
                                    value={name}
                                    onChange={(event) => {
                                        setName(event.target.value);
                                        setProblem(null);
                                    }}
                                    maxLength={100}
                                    autoComplete="off"
                                    aria-invalid={problem ? true : undefined}
                                    aria-describedby={problem ? `${nameId}-message` : undefined}
                                />
                                {problem && <p id={`${nameId}-message`} className="text-sm text-destructive">{problem}</p>}
                                {renamed && !problem && (
                                    <p className="text-xs text-muted-foreground">
                                        Backups and recovery kits find the key by its ID, so they keep working. A config backup that is imported links its jobs to a key by name.
                                    </p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={descriptionId}>Description</Label>
                                <Input
                                    id={descriptionId}
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                    maxLength={500}
                                    placeholder="Optional, like which jobs it is meant for"
                                    autoComplete="off"
                                />
                            </div>
                            <dl className="divide-y border-y text-sm">
                                {[
                                    { label: "Key ID", value: <KeyIdText keyId={keyRow.keyId} /> },
                                    { label: "Encrypts", value: keyUse(keyRow) },
                                    { label: "Created", value: <ActorText date={keyRow.createdAt} actor={keyRow.created} /> },
                                ].map((fact) => (
                                    <div key={fact.label} className="flex min-w-0 items-baseline justify-between gap-3 py-2">
                                        <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
                                        <dd className="min-w-0 truncate text-right">{fact.value}</dd>
                                    </div>
                                ))}
                            </dl>
                            <p className="text-xs text-muted-foreground">The key itself never changes. For a new one, create a key and pick it in the jobs.</p>
                        </div>
                    </ScrollArea>

                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                        <DialogClose asChild>
                            <Button type="button" variant="ghost" disabled={saving}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            Save changes
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
