"use client";

import { useState } from "react";
import { Archive, CircleCheck, Download, Loader2, LockKeyhole, Trash, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { deleteEncryptionProfile } from "@/app/actions/backup/encryption";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { TrashConfirmDialog, toastMovedToTrash, useTrashUntil } from "@/components/ui/delete-mode";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { useTrash } from "@/components/trash/use-trash";
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
    /** After Undo brought it back, to load the list again. */
    onRestored: () => void | Promise<void>;
    /** Whether the viewer may download a recovery kit, offered here while the key was never in one. */
    canKit: boolean;
    /** After a kit with the key was downloaded from here. */
    onKitDownloaded: () => void;
}

/**
 * Deletes one key. While a job or the config backup encrypts with it, it names them and keeps
 * Delete off, since the server refuses it: the jobs would store their next backups in the clear.
 * Otherwise the key moves to Recently deleted, where a restore opens its backups again. Deleted
 * permanently, for a key that leaked, it lists the backups it leaves unreadable and offers a kit.
 */
export function KeyDeleteDialog({ keyRow, onClose, onDeleted, onRestored, canKit, onKitDownloaded }: KeyDeleteDialogProps) {
    const [pending, setPending] = useState(false);
    const [kitting, setKitting] = useState(false);
    const [kitAt, setKitAt] = useState<string | null>(keyRow.kit?.at ?? null);
    const trash = useTrash("encryptionKey", onRestored);
    const until = useTrashUntil(trash.days);
    const blocker = keyBlocker(keyRow);
    const backups = keyRow.backups;

    const remove = async (permanently: boolean) => {
        setPending(true);
        try {
            const result = await deleteEncryptionProfile(keyRow.id, { permanently });
            if (result.success) {
                if (permanently) toast.success("Key deleted");
                else toastMovedToTrash(`${keyRow.name} moved to Recently deleted`, trash.days, () => trash.undo([keyRow.id]));
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

    if (blocker) {
        const users = keyRow.jobs.length + (keyRow.configBackup ? 1 : 0);
        return (
            <ConfirmDialog
                open
                onOpenChange={(open) => !open && onClose()}
                icon={Trash}
                destructive
                title={`Delete ${keyRow.name}?`}
                note={`${users === 1 && keyRow.configBackup ? "The config backup" : count(users, "job")} still ${users === 1 ? "encrypts" : "encrypt"} with it`}
                description="Pick another key there first, or their next backups would be stored in the clear."
                confirmLabel="Delete key"
                disabled
                onConfirm={() => undefined}
            >
                <KeyUsers keyRow={keyRow} />
                {backups > 0 && <p className="text-xs text-muted-foreground">Its {count(backups, "backup")} stay as they are and still need this key.</p>}
            </ConfirmDialog>
        );
    }

    const them = backups === 1 ? "the backup it encrypted" : `the ${count(backups, "backup")} it encrypted`;
    const more = backups - keyRow.recent.length;
    const backupList = (
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
    );
    const kitRow = kitAt ? (
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
    );

    return (
        <TrashConfirmDialog
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            title={`Delete ${keyRow.name}?`}
            note={backups === 0 ? "No backup in the listings needs it" : `${count(backups, "backup")} ${backups === 1 ? "needs" : "need"} this key`}
            confirmLabel="Delete key"
            days={trash.days}
            canDeletePermanently={trash.canDeletePermanently}
            restoreLine={backups > 0 ? `Restore it until ${until} and ${them} ${backups === 1 ? "opens" : "open"} again.` : undefined}
            permanentLine={backups > 0
                ? `For a key that leaked. It skips Recently deleted, and without a recovery kit ${them} can never be opened again, by DBackup neither.`
                : "For a key that leaked. It skips Recently deleted."}
            permanentNotice={`${keyRow.name} is gone at once. DBackup keeps no copy of it anywhere.`}
            permanentChildren={backups > 0 && (
                <>
                    {backupList}
                    {kitRow}
                </>
            )}
            isPending={pending}
            onConfirm={(permanently) => void remove(permanently)}
        >
            {backups === 0 && <DialogItemList items={[{ name: keyRow.name, detail: keyRow.keyId ? `Key ID ${keyRow.keyId}` : undefined, icon: LockKeyhole }]} />}
        </TrashConfirmDialog>
    );
}
