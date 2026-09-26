"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, Copy, History, KeyRound, ShieldCheck } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { answerOf } from "@/components/dashboard/storage/explorer/explorer-state";
import { AnswerDot } from "@/components/dashboard/storage/explorer/explorer-cells";
import { Notice, OutcomeTag, type TagTone } from "@/components/dashboard/storage/restore/restore-parts";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn, formatBytes } from "@/lib/utils";
import type { BackupCopy, ExplorerDestination, ExplorerFile } from "@/services/storage/explorer-types";
import { checkOrder, copyRows, howText, lastCheckText, statusOf, summaryText, verifiable, type CopyRow, type CopyStatus } from "./integrity-model";
import { useCopyVerification } from "./use-copy-verification";

const TAGS: Record<CopyStatus, { tone: TagTone; label: string; icon: "check" | "alert" | "spin" | "help" | "none" }> = {
    passed: { tone: "success", label: "Passed", icon: "check" },
    failed: { tone: "destructive", label: "Does not match", icon: "alert" },
    never: { tone: "muted", label: "Not checked", icon: "none" },
    missing: { tone: "muted", label: "Missing", icon: "none" },
    unverifiable: { tone: "muted", label: "No checksum", icon: "none" },
    waiting: { tone: "muted", label: "Waiting", icon: "none" },
    checking: { tone: "muted", label: "Checking", icon: "spin" },
    skipped: { tone: "muted", label: "Skipped", icon: "help" },
    error: { tone: "destructive", label: "Could not check", icon: "alert" },
};

const bytes = (value: number) => formatBytes(value, 1);

interface IntegrityDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The file of the copy the dialog was opened from, and every copy of its backup. */
    file: ExplorerFile;
    copies: BackupCopy[];
    focusDestinationId: string;
    destinations: Map<string, ExplorerDestination>;
    canViewHistory: boolean;
    /** Reloads the lists, so a new check shows there too. */
    onChanged: () => void;
}

/**
 * The integrity of a backup: every copy with its last check, how it is checked and a Verify of
 * its own, and Verify all, which checks the copies without a download first. A check runs on the
 * server and shows in History, the dialog follows it while it is open.
 */
export function IntegrityDialog({ open, onOpenChange, file, copies, focusDestinationId, destinations, canViewHistory, onChanged }: IntegrityDialogProps) {
    const { formatDate } = useDateFormatter();
    const rows = copyRows(copies, destinations, focusDestinationId);
    const check = useCopyVerification((result) => {
        const failed = result.copies.filter((copy) => copy.state === "failed").length;
        if (failed > 0) toast.error(`${failed} ${failed === 1 ? "copy does" : "copies do"} not match the checksum`);
        else toast.success(result.copies.length === 1 ? "The copy matches its checksum" : "The checked copies match their checksum");
        onChanged();
    });
    const statuses = rows.map((row) => statusOf(row, check.live.get(row.destinationId)));
    const failedNames = rows.filter((_, index) => statuses[index] === "failed").map((row) => row.name);
    const checkable = checkOrder(rows.filter(verifiable));
    const run = check.run;
    const doneCount = run ? run.copies.filter((copy) => copy.state !== "waiting" && copy.state !== "checking").length : 0;

    const verify = (targets: CopyRow[]) => void check.start(targets.map((row) => ({ destinationId: row.destinationId, file: row.file!.path })));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-3xl")}>
                <div className="flex max-h-[90dvh] min-h-0 flex-col">
                    <DialogHead tone="neutral" icon={ShieldCheck}>
                        <DialogTitle className="truncate text-base">Integrity of {file.jobName ?? file.name}</DialogTitle>
                        <DialogDescription className={cn(dialogNoteClass("neutral"), "truncate")}>
                            {file.name} · {rows.length} {rows.length === 1 ? "copy" : "copies"}
                        </DialogDescription>
                    </DialogHead>

                    <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-9rem)]">
                        <div className="space-y-4 p-5">
                            {run && !["Success", "Failed"].includes(run.status) && (
                                <div className="space-y-2 rounded-lg border px-3 py-2.5">
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="font-medium">Checking {run.copies.length} {run.copies.length === 1 ? "copy" : "copies"}</span>
                                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{doneCount} of {run.copies.length} done</span>
                                    </div>
                                    <Progress value={run.progress} aria-label="Progress of the check" className="h-1.5" />
                                </div>
                            )}
                            {failedNames.length > 0 && (
                                <Notice tone="destructive" icon={AlertTriangle} title={`${failedNames.join(", ")} ${failedNames.length === 1 ? "holds a file" : "hold files"} that differ from the upload`}>
                                    A restore or a download reads from a copy that passed. Verify again, or delete the broken copy and let the next run write it anew.
                                </Notice>
                            )}

                            <section aria-label="Copies" className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-sm font-semibold">Copies</h3>
                                    <span className="ml-auto text-xs text-muted-foreground">{summaryText(statuses)}</span>
                                </div>
                                <ul className="divide-y overflow-hidden rounded-lg border">
                                    {rows.map((row, index) => {
                                        const live = check.live.get(row.destinationId);
                                        const tag = TAGS[statuses[index]];
                                        const label = statuses[index] === "checking" && live?.total ? `Checking ${Math.round(((live.processed ?? 0) / live.total) * 100)}%` : tag.label;
                                        return (
                                            <li key={row.destinationId} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap", !row.file && "opacity-60")}>
                                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted [&_svg]:size-4" aria-hidden="true">
                                                    <AdapterIcon adapterId={row.adapterId} />
                                                </span>
                                                <span className="grid min-w-0 flex-1 gap-0.5">
                                                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                                                        {row.destination && <AnswerDot answer={answerOf(row.destination)} />}
                                                        <span className="truncate">{row.name}</span>
                                                    </span>
                                                    <span className="truncate text-xs text-muted-foreground">{howText(row, bytes)}</span>
                                                </span>
                                                <span className="min-w-0 text-xs text-muted-foreground sm:w-48 sm:text-right">{lastCheckText(row, live, (date) => formatDate(date, "Pp"), bytes)}</span>
                                                <OutcomeTag tone={tag.tone} icon={tag.icon}>{label}</OutcomeTag>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8"
                                                    onClick={() => verify([row])}
                                                    disabled={check.running || !verifiable(row)}
                                                    aria-label={`Verify the copy at ${row.name}`}
                                                >
                                                    Verify
                                                </Button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>

                            <Checksums file={file} />
                        </div>
                    </ScrollArea>

                    <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center gap-3")}>
                        <span className="hidden min-w-0 flex-1 text-xs text-muted-foreground sm:block">
                            {check.running ? "The check runs on the server, closing the dialog does not stop it." : "Copies with a checksum of their own are checked without a download, and first."}
                        </span>
                        <div className="ml-auto flex gap-2">
                            {run && canViewHistory && (
                                <Button variant="outline" asChild>
                                    <Link href={`/dashboard/history?executionId=${encodeURIComponent(run.executionId)}`}>
                                        <History />
                                        Open in History
                                    </Link>
                                </Button>
                            )}
                            <DialogClose asChild>
                                <Button type="button" variant="outline">Close</Button>
                            </DialogClose>
                            {!check.running && checkable.length > 1 && (
                                <Button variant="outline" onClick={() => verify(checkable)}>
                                    <ShieldCheck />
                                    Verify all {checkable.length} copies
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** The checksums the upload recorded, folded, since the list of copies says what they found. */
function Checksums({ file }: { file: ExplorerFile }) {
    const [open, setOpen] = useState(false);
    const values = [["SHA-256", file.checksum], ["MD5", file.checksumMd5]].filter((entry): entry is [string, string] => !!entry[1]);
    if (values.length === 0) return <p className="text-xs text-muted-foreground">This backup was stored without a checksum, so no copy of it can be checked.</p>;
    return (
        <div className="rounded-lg border">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">Stored checksums</span>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{values[0][0]} {values[0][1].slice(0, 8)}…{values[0][1].slice(-8)}</span>
                <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
            </button>
            {open && (
                <div className="divide-y border-t">
                    {values.map(([label, value]) => <ChecksumRow key={label} label={label} value={value} />)}
                </div>
            )}
        </div>
    );
}

function ChecksumRow({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <div className="flex items-start gap-3 py-2 pr-1.5 pl-3">
            <span className="w-14 shrink-0 pt-1.5 text-xs text-muted-foreground">{label}</span>
            <span className="min-w-0 flex-1 pt-1.5 font-mono text-xs break-all">{value}</span>
            <Button type="button" variant="ghost" size="icon" className="size-8" onClick={copy} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
        </div>
    );
}
