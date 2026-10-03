"use client";

import { Download, Eye, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { revealMasterKey } from "@/app/actions/backup/encryption";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { VaultKey } from "@/services/vault/vault-types";
import { SecretField } from "./secret-field";

const log = logger.child({ component: "key-reveal-dialog" });

/**
 * Asks the server for a key in the clear, which writes an entry to the audit log first. Null when it
 * was refused, which a toast explains. Called from a click, so a reveal happens once per click.
 */
export async function revealKey(key: Pick<VaultKey, "id">): Promise<string | null> {
    try {
        const result = await revealMasterKey(key.id);
        if (result.success && result.data) return result.data;
        toast.error(result.error || "The key could not be revealed.");
    } catch (error) {
        // Without the right to write to the Vault the action throws instead of answering.
        log.warn("Revealing a key failed", { profileId: key.id }, wrapError(error));
        toast.error("The key could not be revealed.");
    }
    return null;
}

interface KeyRevealDialogProps {
    keyRow: VaultKey;
    /** Null while the server answers. */
    value: string | null;
    onClose: () => void;
    /** Opens the recovery kit of the key, the better way to keep it. */
    onKit?: (key: VaultKey) => void;
}

/** A key in the clear, with a pointer to the recovery kit, which keeps it together with the tool that uses it. */
export function KeyRevealDialog({ keyRow, value, onClose, onKit }: KeyRevealDialogProps) {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent tone="warning" showCloseButton={false} className={DIALOG_SURFACE}>
                <DialogHead tone="warning" icon={Eye}>
                    <DialogTitle className="truncate text-base">Key of {keyRow.name}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("warning")}>This was written to the audit log</DialogDescription>
                </DialogHead>

                <div className="grid min-w-0 gap-4 p-5">
                    {keyRow.keyId && <SecretField label="Key ID" value={keyRow.keyId} copy={false} />}
                    {value === null ? (
                        <div className="space-y-1.5" aria-busy="true">
                            <Skeleton className="h-4 w-12" />
                            <Skeleton className="h-14 w-full" />
                        </div>
                    ) : (
                        <SecretField label="Key" value={value} />
                    )}
                    <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                        <span>Anyone with this key and your backups can read them. A recovery kit is the better way to keep it, it holds the key and the tool to use it.</span>
                    </div>
                    {onKit && (
                        <div>
                            <Button variant="outline" size="sm" onClick={() => onKit(keyRow)}>
                                <Download />
                                Download recovery kit
                            </Button>
                        </div>
                    )}
                </div>

                <div className={cn(DIALOG_FOOTER, "flex justify-end")}>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}
