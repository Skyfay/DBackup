"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { RestartWait } from "@/components/config-restore/restart-wait";
import { RestoreContents } from "@/components/config-restore/restore-contents";
import { EncryptionKeyResolutionDialog, type KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import { WRONG_KEY } from "@/hooks/use-encryption-key-recovery";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogBackButton, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CONFIG_UPLOAD_FILES_MAX_BYTES, CONFIG_UPLOAD_TOO_BIG } from "@/lib/core/config-upload";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { RestorePreview } from "@/lib/types/config-backup";
import { cn } from "@/lib/utils";

const log = logger.child({ component: "config-restore-dialog" });

interface ConfigRestoreDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface Checked {
    token: string;
    fileName: string;
    preview: RestorePreview;
}

interface Answer<T> {
    success: boolean;
    error?: string;
    code?: string;
    profileId?: string;
    data?: T;
}

type Step = "file" | "check" | "restarting";

/** The size of the files in a form, to refuse one the middleware would cut off before it is sent. */
function filesSize(formData: FormData): number {
    return ["backupFile", "metaFile"].reduce((sum, key) => {
        const file = formData.get(key);
        return sum + (file instanceof File ? file.size : 0);
    }, 0);
}

async function post<T>(url: string, body: FormData | object): Promise<{ status: number; answer: Answer<T> }> {
    const response = await fetch(url, body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, answer: (await response.json().catch(() => ({ success: false }))) as Answer<T> };
}

/**
 * Restore from a file, in two steps: the file is checked and the dialog shows what it holds, then
 * Restore. A copy of the database replaces everything and DBackup restarts, a file of an older
 * version is imported as a whole and says in a toast what it could not bring back.
 */
export function ConfigRestoreDialog({ open, onOpenChange }: ConfigRestoreDialogProps) {
    const router = useRouter();
    const [step, setStep] = useState<Step>("file");
    const [checked, setChecked] = useState<Checked | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const pending = useRef<FormData | null>(null);
    const [keyDialog, setKeyDialog] = useState<{ open: boolean; profileId: string; error?: string }>({ open: false, profileId: "" });

    const database = checked?.preview.kind === "database";
    const tone = step === "check" && database ? "destructive" : "warning";

    const reset = () => {
        setStep("file");
        setChecked(null);
        setProblem(null);
        pending.current = null;
    };

    const checkFile = async (formData: FormData): Promise<boolean> => {
        if (filesSize(formData) > CONFIG_UPLOAD_FILES_MAX_BYTES) {
            setProblem(CONFIG_UPLOAD_TOO_BIG);
            return false;
        }
        setProblem(null);
        setBusy(true);
        try {
            const { answer } = await post<Checked>("/api/settings/config-backup/restore", formData);
            if (answer.success && answer.data) {
                setChecked(answer.data);
                setStep("check");
                pending.current = null;
                return true;
            }
            if (answer.code === "ENCRYPTION_KEY_REQUIRED") {
                // The key of the file was not found by itself, so it is asked for. A key that was
                // tried and does not fit keeps the dialog open and says so.
                const tried = formData.has("encryptionKeyHex") || formData.has("encryptionProfileIdOverride");
                pending.current = formData;
                setKeyDialog({ open: true, profileId: answer.profileId ?? "", error: tried ? answer.error || WRONG_KEY : undefined });
                return false;
            }
            // Any other answer shows in this dialog, so the one of the key steps aside.
            setKeyDialog({ open: false, profileId: "" });
            setProblem(answer.error ?? "The file could not be read.");
            return false;
        } catch (error: unknown) {
            log.warn("Checking a configuration backup failed", {}, wrapError(error));
            setKeyDialog({ open: false, profileId: "" });
            setProblem("The file could not be read.");
            return false;
        } finally {
            setBusy(false);
        }
    };

    const withKey = async (result: KeyResolutionResult) => {
        const formData = pending.current;
        if (!formData) return;
        // Only the key of this try, a typed key would otherwise win over a profile picked after it.
        formData.delete("encryptionKeyHex");
        formData.delete("encryptionProfileIdOverride");
        if (result.type === "rawKey") formData.set("encryptionKeyHex", result.keyHex);
        else formData.set("encryptionProfileIdOverride", result.profileId);
        if (await checkFile(formData)) setKeyDialog({ open: false, profileId: "" });
    };

    const restore = async () => {
        if (!checked) return;
        setBusy(true);
        try {
            const { answer } = await post<{ restarting?: boolean; notes?: string[] }>("/api/settings/config-backup/restore/apply", { token: checked.token });
            if (!answer.success || !answer.data) {
                setProblem(answer.error ?? "The restore failed.");
                return;
            }
            if (answer.data.restarting) {
                setStep("restarting");
                return;
            }
            const notes = answer.data.notes ?? [];
            if (notes.length > 0) {
                toast.warning(notes.length === 1 ? "The configuration is restored, 1 thing needs a look" : `The configuration is restored, ${notes.length} things need a look`, {
                    description: notes.join(" "),
                });
            } else {
                toast.success("The configuration is restored");
            }
            onOpenChange(false);
            reset();
            router.refresh();
        } catch (error: unknown) {
            log.warn("Restoring a configuration failed", {}, wrapError(error));
            setProblem("The restore failed.");
        } finally {
            setBusy(false);
        }
    };

    const note = step === "file" ? "Step 1 of 2 · The file" : step === "check" ? (database ? "Step 2 of 2 · Replaces everything here" : "Step 2 of 2 · Restores it as a whole") : "Restarting";

    return (
        <>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (busy || step === "restarting") return;
                    if (!next) reset();
                    onOpenChange(next);
                }}
            >
                <DialogContent tone={tone} showCloseButton={false} className={cn(DIALOG_SURFACE, step === "check" ? "sm:max-w-3xl" : "sm:max-w-lg")}>
                    <DialogHead
                        tone={tone}
                        icon={step === "restarting" ? RotateCw : Upload}
                        action={step === "check" && !busy && <DialogBackButton onClick={reset}>Other file</DialogBackButton>}
                    >
                        <DialogTitle className="text-base">Restore from a file</DialogTitle>
                        <DialogDescription className={dialogNoteClass(tone)}>{note}</DialogDescription>
                    </DialogHead>

                    {step === "file" && (
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void checkFile(new FormData(event.currentTarget));
                            }}
                        >
                            <div className="space-y-4 p-5">
                                <div className="space-y-2">
                                    <Label htmlFor="config-backup-file">Configuration backup</Label>
                                    <Input id="config-backup-file" name="backupFile" type="file" required accept=".db,.json,.gz,.enc,.br" onChange={() => setProblem(null)} />
                                    <p className="text-xs text-muted-foreground">The file itself, like config_backup_2026-09-29.db.gz.enc, up to 10 MB.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="config-meta-file">Its metadata</Label>
                                    <Input id="config-meta-file" name="metaFile" type="file" accept=".json" onChange={() => setProblem(null)} />
                                    <p className="text-xs text-muted-foreground">The .meta.json beside it, needed for an encrypted file. DBackup looks for the key by itself and asks when it finds none.</p>
                                </div>
                                {problem && <p className="text-xs text-destructive">{problem}</p>}
                            </div>
                            <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={busy}>
                                    {busy ? <Loader2 className="animate-spin" /> : <Upload />}
                                    Check the file
                                </Button>
                            </div>
                        </form>
                    )}

                    {step === "check" && checked && (
                        <>
                            <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-10rem)]">
                                <div className="space-y-4 p-5">
                                    <RestoreContents preview={checked.preview} fileName={checked.fileName} />
                                    {database && (
                                        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                                            <span className="font-medium">Everything here is replaced.</span>{" "}
                                            <span className="text-muted-foreground">Connections, jobs, users and the history of this DBackup become the ones of the backup, and DBackup restarts for about a minute.</span>
                                        </p>
                                    )}
                                    {problem && <p className="text-xs text-destructive">{problem}</p>}
                                </div>
                            </ScrollArea>
                            <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                                    Cancel
                                </Button>
                                <Button type="button" onClick={() => void restore()} disabled={busy}>
                                    {busy ? <Loader2 className="animate-spin" /> : database ? <RotateCw /> : <Upload />}
                                    {database ? "Replace and restart" : "Restore and overwrite"}
                                </Button>
                            </div>
                        </>
                    )}

                    {step === "restarting" && <RestartWait />}
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
                loading={busy}
                error={keyDialog.error}
            />
        </>
    );
}
