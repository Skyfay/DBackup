"use client";

import { useId, useRef, useState } from "react";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { TrashRow } from "@/services/trash/trash-types";

/** What a restore under another name still brings back, per kind that has more than its name. */
const COMES_BACK: Partial<Record<TrashRow["kind"], string>> = {
    encryptionKey: "It comes back with its own key, so the backups it encrypted open again.",
    user: "It comes back with its password, second factor, passkeys and API keys, under the email you give it.",
    job: "It comes back with its destinations and runs, paused when its encryption key is gone.",
};

interface RestoreAsDialogProps {
    row: TrashRow;
    /** Why its own name does not work, as the server said it. */
    reason: string;
    onRestore: (name: string) => Promise<string | null>;
    onClose: () => void;
}

/**
 * Restores a deleted record whose name, or email for a user, someone took meanwhile, under one the
 * person picks. It starts with the old name and "(restored)" selected, so Enter restores at once.
 */
export function RestoreAsDialog({ row, reason, onRestore, onClose }: RestoreAsDialogProps) {
    const isUser = row.kind === "user";
    const [name, setName] = useState(isUser ? "" : `${row.name} (restored)`);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const field = useRef<HTMLInputElement>(null);
    const nameId = useId();
    const trimmed = name.trim();

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!trimmed || pending) return;
        setPending(true);
        // Null when it is back, otherwise why not, like a second name that is taken as well.
        const refused = await onRestore(trimmed);
        setPending(false);
        if (refused) setError(refused);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent
                tone="create"
                showCloseButton={false}
                className={cn(DIALOG_SURFACE, "sm:max-w-lg")}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    field.current?.focus();
                    field.current?.select();
                }}
            >
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                    <DialogHead tone="create" icon={ArchiveRestore}>
                        <DialogTitle className="truncate text-base">Restore {row.name}</DialogTitle>
                        <DialogDescription className={cn(dialogNoteClass("create"), "truncate")}>
                            Deleted <RelativeTime date={row.deletedAt} />{row.deletedByName ? ` by ${row.deletedByName}` : ""}
                        </DialogDescription>
                    </DialogHead>

                    <div className="space-y-4 p-5">
                        {COMES_BACK[row.kind] && <p className="text-sm text-muted-foreground">{COMES_BACK[row.kind]}</p>}
                        <div className="space-y-2">
                            <Label htmlFor={nameId}>{isUser ? "Restore it with the email" : "Restore it as"}</Label>
                            <Input
                                ref={field}
                                id={nameId}
                                type={isUser ? "email" : "text"}
                                placeholder={isUser ? "name@example.com" : undefined}
                                value={name}
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setError(null);
                                }}
                                disabled={pending}
                                autoComplete="off"
                                aria-invalid={error ? true : undefined}
                                aria-describedby={`${nameId}-message`}
                            />
                            <p id={`${nameId}-message`} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
                                {error ?? reason}
                            </p>
                        </div>
                    </div>

                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                        <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={pending}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={pending || !trimmed}>
                            {pending ? <Loader2 className="animate-spin" /> : <ArchiveRestore />}
                            Restore
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
