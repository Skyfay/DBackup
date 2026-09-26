"use client";

import { ArrowLeft, FolderOpen, KeyRound } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { answerOf } from "@/components/dashboard/storage/explorer/explorer-state";
import { AnswerDot } from "@/components/dashboard/storage/explorer/explorer-cells";
import { useExplorerData } from "@/components/dashboard/storage/explorer/explorer-data";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import type { ExplorerIndex } from "@/services/storage/explorer-types";
import { RestoreTimeline } from "./restore-timeline";

function Fact({ children }: { children: React.ReactNode }) {
    return <span className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] font-medium text-foreground">{children}</span>;
}

interface RestoreHeadProps {
    file: FileInfo;
    destinationId: string;
    /** "Databases only" or "Files only" for half of a backup with both. */
    scopeLabel: string | null;
    mode: string | null;
    onBack: () => void;
}

/**
 * What is restored: the job with its logo and when the backup was made, its facts, the copy it
 * reads from and whether that destination answers, and the small timeline of the job on the right.
 */
export function RestoreHead({ file, destinationId, scopeLabel, mode, onBack }: RestoreHeadProps) {
    const index = useExplorerData<ExplorerIndex>("/api/storage/explorer");
    const destination = index.data?.destinations.find((entry) => entry.id === destinationId) ?? null;
    const folders = (file.sourceType ?? "").toLowerCase() === "directory-only";
    const engine = [file.sourceType && !folders ? file.sourceType : null, file.engineVersion, file.engineEdition ? `(${file.engineEdition})` : null].filter(Boolean).join(" ");

    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button variant="outline" size="icon" className="size-8 shrink-0" aria-label="Back to the Storage Explorer" onClick={onBack}>
                <ArrowLeft />
            </Button>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted" aria-hidden="true">
                {folders || !file.sourceType ? <FolderOpen className="size-5 text-muted-foreground" /> : <AdapterIcon adapterId={file.sourceType.toLowerCase()} className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold tracking-tight">Restore {file.jobName ?? file.name}</h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatBytes(file.size)}</span>
                    {engine && <span>· {engine}</span>}
                    {file.backupType && <Fact>{file.backupType === "incremental" ? "Incremental" : "Full"}</Fact>}
                    {file.isEncrypted && (
                        <Fact>
                            <KeyRound className="size-3 text-muted-foreground" aria-hidden="true" />
                            Encrypted
                        </Fact>
                    )}
                    {scopeLabel && <Fact>{scopeLabel}</Fact>}
                    {destination && (
                        <span className="inline-flex items-center gap-1.5">
                            · reads from
                            <AnswerDot answer={answerOf(destination)} />
                            <span className="font-medium text-foreground">{destination.name}</span>
                        </span>
                    )}
                </div>
            </div>
            <div className="w-full min-w-0 lg:w-auto">
                <RestoreTimeline file={file} destinationId={destinationId} mode={mode} />
            </div>
        </div>
    );
}
