"use client";

import { useId, useState } from "react";
import { Archive, CircleCheck, Download, Loader2, LockKeyhole, Trash, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { deleteEncryptionProfile } from "@/app/actions/backup/encryption";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { formatBytes } from "@/lib/utils";
import type { VaultKey } from "@/services/vault/vault-types";
import { KeyUsers } from "./key-details";
import { downloadRecoveryKit } from "./kit-download";
import { count, keyBlocker } from "./vault-format";

const log = logger.child({ component: "key-delete-dialog" });

interface KeyDeleteDialogProps {
    keyRow: VaultKey;
    onClose: () => void;
    onDeleted: (id: string) => void;
    /** Whether the viewer may download a recovery kit, offered here while the key was never in one. */
    canKit: boolean;
    /** After a kit with the key was downloaded from here. */
    onKitDownloaded: () => void;
}

/**
 * Deletes one key. While a job or the config backup encrypts with it, it names them and keeps
 * Delete off, since the server refuses it: the jobs would store their next backups in the clear.
 * A key that backups still need asks to confirm that a recovery kit keeps it.
 */
export function KeyDeleteDialog({ keyRow, onClose, onDeleted, canKit, onKitDownloaded }: KeyDeleteDialogProps) {
    const [pending, setPending] = useState(false);
    const [kept, setKept] = useState(false);
    const [kitting, setKitting] = useState(false);
    const [kitAt, setKitAt] = useState<string | null>(keyRow.kit?.at ?? null);
    const tickId = useId();
    const blocker = keyBlocker(keyRow);
    const backups = keyRow.backups;

    const remove = async () => {
        setPending(true);
        try {
            const result = await deleteEncryptionProfile(keyRow.id);
            if (result.success) {
                toast.success("Key deleted");
                onDeleted(keyRow.id);
                return;
            }
            toast.error(result.error || "The key could not be deleted.");
        } catch (error) {
            // Without the right to write to the Vault the action throws instead of answering.
            log.warn("Deleting a key failed", { profileId: keyRow.id }, wrapError(error));
            toast.error("The key could not be deleted.");
        } finally {
            setPending(false);
        }
        onClose();
    };

    // The kit of this one key, right here, so the delete does not have to wait for another dialog.
    const downloadKit = async () => {
        setKitting(true);
        const done = await downloadRecoveryKit([keyRow.id]);
        setKitting(false);
        if (!done) return;
        setKitAt(new Date().toISOString());
        onKitDownloaded();
    };

    const common = { open: true, onOpenChange: (open: boolean) => !open && onClose(), icon: Trash, destructive: true, confirmLabel: "Delete key", onConfirm: remove };

    if (blocker) {
        const users = keyRow.jobs.length + (keyRow.configBackup ? 1 : 0);
        return (
            <ConfirmDialog
                {...common}
                title={`Delete ${keyRow.name}?`}
                note={`${users === 1 && keyRow.configBackup ? "The config backup" : count(users, "job")} still ${users === 1 ? "encrypts" : "encrypt"} with it`}
                description="Pick another key there first, or their next backups would be stored in the clear."
                disabled
            >
                <KeyUsers keyRow={keyRow} />
                {backups > 0 && <p className="text-xs text-muted-foreground">Its {count(backups, "backup")} stay as they are and still need this key.</p>}
            </ConfirmDialog>
        );
    }

    if (backups === 0) {
        return (
            <ConfirmDialog {...common} title="Delete key?" note="Cannot be undone" description="No backup in the listings of the destinations needs it." isPending={pending}>
                <DialogItemList items={[{ name: keyRow.name, detail: keyRow.keyId ? `Key ID ${keyRow.keyId}` : undefined, icon: LockKeyhole }]} />
            </ConfirmDialog>
        );
    }

    const more = backups - keyRow.recent.length;
    return (
        <ConfirmDialog
            {...common}
            title={`Delete ${keyRow.name}?`}
            note={`${count(backups, "backup")} ${backups === 1 ? "needs" : "need"} this key`}
            description={backups === 1
                ? "This backup opens only with this key. After the delete nobody can open it, DBackup neither."
                : "These backups open only with this key. After the delete nobody can open them, DBackup neither."}
            isPending={pending}
            disabled={!kept}
        >
            <div className="grid min-w-0 gap-1.5">
                <DialogItemList
                    size="small"
                    items={keyRow.recent.map((backup) => ({
                        name: backup.name,
                        detail: `${backup.destinationName}, ${formatBytes(backup.size, 1)}`,
                        icon: Archive,
                    }))}
                />
                {more > 0 && <p className="text-xs text-muted-foreground">and {count(more, "more backup")} at {count(keyRow.destinations.length, "destination")}</p>}
            </div>
            {kitAt ? (
                <p className="flex items-center gap-2 text-sm">
                    <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
                    <span>In a recovery kit since <RelativeTime date={kitAt} /></span>
                </p>
            ) : (
                <div className="flex items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/5 py-2 pr-2 pl-3 text-sm">
                    <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span className="min-w-0 flex-1">Never in a recovery kit</span>
                    {canKit && (
                        <Button variant="outline" size="sm" onClick={downloadKit} disabled={kitting}>
                            {kitting ? <Loader2 className="animate-spin" /> : <Download />}
                            Download kit
                        </Button>
                    )}
                </div>
            )}
            <div className="flex items-start gap-2.5">
                <Checkbox id={tickId} checked={kept} onCheckedChange={(value) => setKept(value === true)} className="mt-0.5" />
                <Label htmlFor={tickId} className="text-sm leading-snug font-normal">
                    I keep a recovery kit with this key, or I do not need {backups === 1 ? "its backup" : "its backups"} any more
                </Label>
            </div>
        </ConfirmDialog>
    );
}
