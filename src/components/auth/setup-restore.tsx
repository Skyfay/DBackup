"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, RotateCcw, RotateCw } from "lucide-react";
import { RestartWait } from "@/components/config-restore/restart-wait";
import { RestoreContents } from "@/components/config-restore/restore-contents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONFIG_UPLOAD_FILES_MAX_BYTES, CONFIG_UPLOAD_TOO_BIG } from "@/lib/core/config-upload";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { RestorePreview } from "@/lib/types/config-backup";

const log = logger.child({ component: "setup-restore" });

interface Checked {
    token: string;
    fileName: string;
    preview: RestorePreview;
}

interface Answer<T> {
    success: boolean;
    error?: string;
    code?: string;
    data?: T;
}

type Step = "file" | "check" | "restarting";

/**
 * Restore from a backup on the sign-up page of a new DBackup, beside its first account: the
 * backup, its metadata and the key from its recovery kit. The server allows it only while nobody
 * has an account, the moment the sign-up is open to anyone as well.
 */
export function SetupRestore() {
    const [step, setStep] = useState<Step>("file");
    const [checked, setChecked] = useState<Checked | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    const check = async (formData: FormData) => {
        const size = ["backupFile", "metaFile"].reduce((sum, key) => {
            const file = formData.get(key);
            return sum + (file instanceof File ? file.size : 0);
        }, 0);
        if (size > CONFIG_UPLOAD_FILES_MAX_BYTES) {
            setProblem(CONFIG_UPLOAD_TOO_BIG);
            return;
        }
        setProblem(null);
        setBusy(true);
        try {
            const response = await fetch("/api/setup/restore", { method: "POST", body: formData });
            const answer = (await response.json().catch(() => ({ success: false }))) as Answer<Checked>;
            if (answer.success && answer.data) {
                setChecked(answer.data);
                setStep("check");
            } else if (answer.code === "ENCRYPTION_KEY_REQUIRED") {
                setProblem("The key does not open the backup. Paste the key from its recovery kit.");
            } else {
                setProblem(answer.error ?? "The backup could not be read.");
            }
        } catch (error: unknown) {
            log.warn("Checking a backup on the sign-up page failed", {}, wrapError(error));
            setProblem("The backup could not be read.");
        } finally {
            setBusy(false);
        }
    };

    const restore = async () => {
        if (!checked) return;
        setBusy(true);
        try {
            const response = await fetch("/api/setup/restore/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: checked.token }) });
            const answer = (await response.json().catch(() => ({ success: false }))) as Answer<{ restarting?: boolean; notes?: string[] }>;
            if (!answer.success || !answer.data) {
                setProblem(answer.error ?? "The restore failed.");
                return;
            }
            if (answer.data.restarting) {
                setStep("restarting");
                return;
            }
            // A file of an older version is imported right away, and the page now asks its accounts to sign in.
            window.location.reload();
        } catch (error: unknown) {
            log.warn("A restore on the sign-up page failed", {}, wrapError(error));
            setProblem("The restore failed.");
        } finally {
            setBusy(false);
        }
    };

    const database = checked?.preview.kind === "database";

    return (
        <Card className={step === "check" ? "w-full max-w-3xl" : "w-87.5"}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <RotateCcw className="size-4 text-warning" aria-hidden="true" />
                    Or restore from a backup
                </CardTitle>
                <CardDescription>Brings back a DBackup with its accounts. Only while nobody has an account here.</CardDescription>
            </CardHeader>
            <CardContent>
                {step === "file" && (
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void check(new FormData(event.currentTarget));
                        }}
                    >
                        <div className="space-y-2">
                            <Label htmlFor="setup-backup-file">Configuration backup</Label>
                            <Input id="setup-backup-file" name="backupFile" type="file" required accept=".db,.json,.gz,.enc,.br" onChange={() => setProblem(null)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="setup-meta-file">Its metadata</Label>
                            <Input id="setup-meta-file" name="metaFile" type="file" accept=".json" onChange={() => setProblem(null)} />
                            <p className="text-xs text-muted-foreground">The .meta.json beside it, needed for an encrypted file.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="setup-key">Its key</Label>
                            <Input id="setup-key" name="encryptionKeyHex" autoComplete="off" spellCheck={false} className="font-mono" placeholder="64 characters from the recovery kit" onChange={() => setProblem(null)} />
                            <p className="text-xs text-muted-foreground">From the recovery kit of the key the backup is encrypted with.</p>
                        </div>
                        {problem && <p className="text-xs text-destructive">{problem}</p>}
                        <Button type="submit" variant="outline" className="w-full" disabled={busy}>
                            {busy && <Loader2 className="animate-spin" />}
                            Check the backup
                        </Button>
                    </form>
                )}

                {step === "check" && checked && (
                    <div className="space-y-4">
                        <RestoreContents preview={checked.preview} fileName={checked.fileName} />
                        {problem && <p className="text-xs text-destructive">{problem}</p>}
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => { setStep("file"); setChecked(null); setProblem(null); }} disabled={busy}>
                                <ArrowLeft />
                                Other file
                            </Button>
                            <Button type="button" tone="destructive" onClick={() => void restore()} disabled={busy}>
                                {busy ? <Loader2 className="animate-spin" /> : database ? <RotateCw /> : <RotateCcw />}
                                {database ? "Restore and restart" : "Restore"}
                            </Button>
                        </div>
                    </div>
                )}

                {step === "restarting" && <RestartWait />}
            </CardContent>
        </Card>
    );
}
