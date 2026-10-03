"use client";

import { useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, FileArchive, FileJson, FileKey, Loader2, RotateCcw, RotateCw, TriangleAlert, Upload } from "lucide-react";
import { RestartWait } from "@/components/config-restore/restart-wait";
import { RestoreContents } from "@/components/config-restore/restore-contents";
import { keysFromFile, type KitKey } from "@/components/dashboard/vault/kit-file";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toneAttribute } from "@/components/ui/tone";
import { CONFIG_UPLOAD_FILES_MAX_BYTES, CONFIG_UPLOAD_TOO_BIG } from "@/lib/core/config-upload";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { RestorePreview } from "@/lib/types/config-backup";
import { cn, formatBytes } from "@/lib/utils";
import { BackHeading } from "./login-parts";

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

function FileRow({ file, icon: Icon }: { file: File; icon: typeof FileArchive }) {
    return (
        <div className="flex h-10 items-center gap-2.5 rounded-lg border bg-muted/40 px-2.5">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.name}>{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size, 1)}</span>
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
        </div>
    );
}

/**
 * Restore from a backup on the first start of a new DBackup: the backup with its metadata, dropped
 * together, and the key from its recovery kit, pasted or dropped as the kit. The server allows it
 * only while nobody has an account, the moment the first account is open to anyone as well.
 */
export function SetupRestore({ onBack }: { onBack: () => void }) {
    const [step, setStep] = useState<"file" | "check" | "restarting">("file");
    const [backupFile, setBackupFile] = useState<File | null>(null);
    const [metaFile, setMetaFile] = useState<File | null>(null);
    const [key, setKey] = useState("");
    const [kitKeys, setKitKeys] = useState<KitKey[]>([]);
    const [checked, setChecked] = useState<Checked | null>(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const filesInput = useRef<HTMLInputElement>(null);
    const kitInput = useRef<HTMLInputElement>(null);

    const takeFiles = (files: FileList | null) => {
        for (const file of Array.from(files ?? [])) {
            if (file.name.endsWith(".meta.json")) setMetaFile(file);
            else setBackupFile(file);
        }
        setProblem(null);
    };

    const takeKit = async (file: File | undefined) => {
        if (!file) return;
        try {
            const keys = await keysFromFile(file);
            if (keys.length === 1) {
                setKey(keys[0].key);
                setKitKeys([]);
            } else {
                setKitKeys(keys);
            }
            setProblem(null);
        } catch (error: unknown) {
            setProblem(error instanceof Error ? error.message : "The file could not be read.");
        }
    };

    const check = async () => {
        if (!backupFile) {
            setProblem("Drop the backup first, with its .meta.json for an encrypted one.");
            return;
        }
        if (backupFile.size + (metaFile?.size ?? 0) > CONFIG_UPLOAD_FILES_MAX_BYTES) {
            setProblem(CONFIG_UPLOAD_TOO_BIG);
            return;
        }
        const body = new FormData();
        body.set("backupFile", backupFile);
        if (metaFile) body.set("metaFile", metaFile);
        if (key.trim()) body.set("encryptionKeyHex", key.trim());
        setProblem(null);
        setBusy(true);
        try {
            const response = await fetch("/api/setup/restore", { method: "POST", body });
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
            log.warn("Checking a backup on the first start failed", {}, wrapError(error));
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
            log.warn("A restore on the first start failed", {}, wrapError(error));
            setProblem("The restore failed.");
        } finally {
            setBusy(false);
        }
    };

    if (step === "restarting") {
        return (
            <div className="w-full max-w-md">
                <RestartWait />
            </div>
        );
    }

    if (step === "check" && checked) {
        const database = checked.preview.kind === "database";
        return (
            <div className="w-full max-w-2xl">
                <BackHeading title="Restore a backup" sub="What it holds, before it replaces this empty DBackup." onBack={onBack} />
                <RestoreContents preview={checked.preview} fileName={checked.fileName} />
                {problem && <p className="mt-4 text-xs text-destructive">{problem}</p>}
                <div className="mt-6 flex flex-wrap justify-end gap-2">
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
        );
    }

    return (
        <div className="w-full max-w-md">
            <BackHeading title="Restore a backup" sub="A configuration backup of another DBackup." onBack={onBack} />
            <div className="space-y-5">
                <div className="space-y-2">
                    <Label>The backup</Label>
                    <div
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragging(false);
                            takeFiles(event.dataTransfer.files);
                        }}
                        className={cn("space-y-2 rounded-lg border border-dashed p-3 transition-colors", dragging && "border-foreground/40 bg-muted/50")}
                    >
                        {backupFile && <FileRow file={backupFile} icon={FileArchive} />}
                        {metaFile && <FileRow file={metaFile} icon={FileJson} />}
                        <button
                            type="button"
                            onClick={() => filesInput.current?.click()}
                            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <Upload className="size-3.5 shrink-0" aria-hidden="true" />
                            Drop the backup and its .meta.json, or pick them
                        </button>
                    </div>
                    <input ref={filesInput} type="file" multiple accept=".db,.json,.gz,.enc,.br" className="hidden" onChange={(event) => { takeFiles(event.target.files); event.target.value = ""; }} />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="setup-key">Its key</Label>
                    <div className="relative">
                        <Input
                            id="setup-key"
                            value={key}
                            onChange={(event) => { setKey(event.target.value); setProblem(null); }}
                            onDrop={(event) => {
                                event.preventDefault();
                                void takeKit(event.dataTransfer.files[0]);
                            }}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="64 characters from the recovery kit"
                            className="h-10 pr-10 font-mono text-xs"
                        />
                        <button
                            type="button"
                            onClick={() => kitInput.current?.click()}
                            aria-label="Read the key from the recovery kit"
                            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <FileKey className="size-4" aria-hidden="true" />
                        </button>
                    </div>
                    <input ref={kitInput} type="file" accept=".key,.zip,.txt" className="hidden" onChange={(event) => { void takeKit(event.target.files?.[0]); event.target.value = ""; }} />
                    {kitKeys.length > 1 ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            The kit holds {kitKeys.length} keys, take the one of the backup:
                            {kitKeys.map((entry) => (
                                <Button key={entry.key} type="button" variant="outline" size="sm" onClick={() => { setKey(entry.key); setKitKeys([]); }}>
                                    {entry.name ?? "Unnamed key"}
                                </Button>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">Paste it, or drop the kit as .zip on the field. Only needed for an encrypted backup.</p>
                    )}
                </div>

                <p {...toneAttribute("warning")} className="flex gap-2.5 rounded-lg border border-tone/30 bg-tone/5 px-3 py-2.5 text-xs leading-relaxed">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-tone" aria-hidden="true" />
                    Replaces this empty DBackup with the one in the backup and restarts it. You sign in with its accounts afterwards.
                </p>
                {problem && <p className="text-xs text-destructive">{problem}</p>}
                <Button type="button" size="lg" className="w-full" onClick={() => void check()} disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />}
                    Check the backup
                </Button>
            </div>
        </div>
    );
}
