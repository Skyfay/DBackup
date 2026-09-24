"use client";

import { useId, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { createEncryptionProfile } from "@/app/actions/backup/encryption";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";

const log = logger.child({ component: "EncryptionKeyDialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

/** A key as the dialog hands it back, without the key itself. */
export interface CreatedKey {
    id: string;
    name: string;
    description: string | null;
}

/** "Backup key", or "Backup key 2" and on when the Vault holds one by that name, since names are unique. */
export function freeKeyName(taken: string[]): string {
    const names = new Set(taken);
    let name = "Backup key";
    for (let number = 2; names.has(name); number++) name = `Backup key ${number}`;
    return name;
}

interface KeyFormProps {
    /** The names of the keys in the Vault, which a new key cannot take. */
    taken: string[];
    onCreated: (key: CreatedKey) => void;
}

/** The content of the dialog, mounted on every open, so it starts with a name that is free. */
function KeyForm({ taken, onCreated }: KeyFormProps) {
    const [name, setName] = useState(() => freeKeyName(taken));
    const [description, setDescription] = useState("");
    const [problem, setProblem] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const nameId = useId();
    const descriptionId = useId();

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return setProblem("Give the key a name.");
        if (taken.includes(trimmed)) return setProblem("The Vault holds a key by this name already.");
        setIsSaving(true);
        try {
            const res = await createEncryptionProfile(trimmed, description.trim() || undefined);
            if (res.success && res.data) {
                toast.success("Key created");
                onCreated({ id: res.data.id, name: res.data.name, description: res.data.description });
                return;
            }
            toast.error(res.error || "The key could not be created.");
        } catch (error: unknown) {
            // Without the right to write to the Vault the action throws instead of answering.
            log.warn("Encryption key could not be created", {}, wrapError(error));
            toast.error("The key could not be created.");
        }
        setIsSaving(false);
    };

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone="create" icon={KeyRound} className="px-5 py-4">
                <DialogTitle className="text-base">New key</DialogTitle>
                <DialogDescription className={cn(dialogNoteClass("create"), "truncate")}>A key in the Vault that encrypts backups</DialogDescription>
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
                        {problem && (
                            <p id={`${nameId}-message`} className="text-sm text-destructive">
                                {problem}
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
                    <ul className="grid gap-3 text-sm text-muted-foreground">
                        <li className="flex gap-3">
                            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            DBackup makes the key itself, a random 256-bit key that only the Vault holds.
                        </li>
                        <li className="flex gap-3">
                            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            Download its recovery kit in the Vault and keep it somewhere safe, without it the backups cannot be opened.
                        </li>
                    </ul>
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                <DialogClose asChild>
                    <Button type="button" variant="ghost">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="animate-spin" />}
                    Create key
                </Button>
            </div>
        </form>
    );
}

interface EncryptionKeyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The names of the keys in the Vault. */
    taken: string[];
    onCreated: (key: CreatedKey) => void;
}

/** Makes a new key in the Vault, from a field that picks one. */
export function EncryptionKeyDialog({ open, onOpenChange, taken, onCreated }: EncryptionKeyDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone="create" showCloseButton={false} className={DIALOG_SURFACE}>
                <KeyForm taken={taken} onCreated={onCreated} />
            </DialogContent>
        </Dialog>
    );
}
