"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { uploadAndRestoreConfigAction } from "@/app/actions/backup/config-management";
import { EncryptionKeyResolutionDialog, type KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";

const log = logger.child({ component: "config-restore-dialog" });

interface ConfigRestoreDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Restore from a file: a configuration backup and its metadata from this computer, which replace
 * connections, jobs, users and settings. When the key of the file is not found by itself, a
 * second dialog asks for it.
 */
export function ConfigRestoreDialog({ open, onOpenChange }: ConfigRestoreDialogProps) {
    const [restoring, setRestoring] = useState(false);
    const pending = useRef<FormData | null>(null);
    const [keyDialog, setKeyDialog] = useState<{ open: boolean; profileId: string }>({ open: false, profileId: "" });
    const [keyLoading, setKeyLoading] = useState(false);

    const restore = async (formData: FormData) => {
        setRestoring(true);
        try {
            const result = await uploadAndRestoreConfigAction(formData);
            if (result.success) {
                toast.success("The configuration is restored");
                pending.current = null;
                onOpenChange(false);
                return true;
            }
            if ("code" in result && result.code === "ENCRYPTION_KEY_REQUIRED") {
                // The key of the file was not found by itself, so it is asked for.
                pending.current = formData;
                setKeyDialog({ open: true, profileId: result.profileId ?? "" });
                return false;
            }
            toast.error(`The restore failed: ${"error" in result ? result.error : "Unknown error"}`);
            return false;
        } catch (error: unknown) {
            log.warn("Restoring a configuration failed", {}, wrapError(error));
            toast.error("The restore failed.");
            return false;
        } finally {
            setRestoring(false);
        }
    };

    const withKey = async (result: KeyResolutionResult) => {
        const formData = pending.current;
        if (!formData) return;
        setKeyLoading(true);
        if (result.type === "rawKey") formData.set("encryptionKeyHex", result.keyHex);
        else formData.set("encryptionProfileIdOverride", result.profileId);
        const done = await restore(formData);
        setKeyLoading(false);
        if (done) setKeyDialog({ open: false, profileId: "" });
    };

    return (
        <>
            <Dialog open={open} onOpenChange={(next) => !restoring && onOpenChange(next)}>
                <DialogContent tone="warning" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void restore(new FormData(event.currentTarget));
                        }}
                    >
                        <DialogHead tone="warning" icon={Upload}>
                            <DialogTitle className="text-base">Restore from a file</DialogTitle>
                            <DialogDescription className={dialogNoteClass("warning")}>Replaces connections, jobs, users and settings</DialogDescription>
                        </DialogHead>
                        <div className="space-y-4 p-5">
                            <div className="space-y-2">
                                <Label htmlFor="config-backup-file">Configuration backup</Label>
                                <Input id="config-backup-file" name="backupFile" type="file" required accept=".json,.gz,.enc,.br" />
                                <p className="text-xs text-muted-foreground">The file itself, like config_backup_2026-09-29.json.gz.enc.</p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="config-meta-file">Its metadata</Label>
                                <Input id="config-meta-file" name="metaFile" type="file" accept=".json" />
                                <p className="text-xs text-muted-foreground">The .meta.json beside it, needed for an encrypted file. DBackup looks for the key by itself and asks when it finds none.</p>
                            </div>
                            <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                                To bring back only some parts, like the users, open the backup on the Backups page instead.
                            </p>
                        </div>
                        <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={restoring}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={restoring}>
                                {restoring ? <Loader2 className="animate-spin" /> : <Upload />}
                                Restore and overwrite
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <EncryptionKeyResolutionDialog
                open={keyDialog.open}
                onOpenChange={(next) => {
                    setKeyDialog((current) => ({ ...current, open: next }));
                    if (!next) pending.current = null;
                }}
                profileIdHint={keyDialog.profileId}
                onConfirm={(result) => void withKey(result)}
                loading={keyLoading}
            />
        </>
    );
}
