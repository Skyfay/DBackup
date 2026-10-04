"use client";

import { ChevronDown, FolderOpen, HardDrive, ListTree, RotateCcw } from "lucide-react";
import { ConnectionPicker } from "@/components/dashboard/jobs/connection-picker";
import type { AdapterOption } from "@/components/dashboard/jobs/job-form-schema";
import { ArchiveFileTree } from "@/components/dashboard/storage/archive-file-tree";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatBytes } from "@/lib/utils";
import { folderOutcome, type FolderChoice, type FolderOutcome } from "./restore-model";
import { OutcomeTag } from "./restore-parts";
import type { DirectoryAnalysis } from "./use-restore-analysis";

interface Shape {
    flat: boolean;
    noun: string;
}

/** What happens at the path of a folder, the reason on hover where it is not plain. */
export function FolderOutcomeTag({ outcome, shape }: { outcome: FolderOutcome; shape: Shape }) {
    if (outcome === "replaces") return <OutcomeTag tone="warning" icon="alert">Has files, same names are replaced</OutcomeTag>;
    if (outcome === "emptied") {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                        <OutcomeTag tone="warning" icon="alert">Exists, it is emptied first</OutcomeTag>
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-72">This {shape.noun} exists. Everything in it is deleted before the backup is restored into it.</TooltipContent>
            </Tooltip>
        );
    }
    if (outcome === "empty") return <OutcomeTag tone="success" icon="check">Empty</OutcomeTag>;
    if (outcome === "checking") return <OutcomeTag tone="muted" icon="spin">Checking</OutcomeTag>;
    if (outcome === "unverified") {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                        <OutcomeTag tone="muted" icon="help">Not checked</OutcomeTag>
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-72">DBackup could not look at this path beforehand. Files of the same name there are replaced.</TooltipContent>
            </Tooltip>
        );
    }
    if (outcome === "incomplete") return <OutcomeTag tone="muted">Needs a target</OutcomeTag>;
    return <span className="text-xs text-muted-foreground">stays out</span>;
}

interface FolderRowProps {
    folder: FolderChoice;
    meta: DirectoryAnalysis | undefined;
    targets: AdapterOption[];
    shape: Shape;
    file: string;
    destinationId: string;
    profileIdOverride?: string;
    onChange: (patch: Partial<FolderChoice>) => void;
    onBrowse: () => void;
}

/**
 * A folder of the backup: whether it comes back, the directory source and path it goes to and
 * what lies there, and its files as a tree to pick from.
 */
export function FolderRow({ folder, meta, targets, shape, file, destinationId, profileIdOverride, onChange, onBrowse }: FolderRowProps) {
    const origin = meta?.origin;
    const moved = origin && (folder.targetConfigId !== origin.configId || folder.targetPath !== origin.path);
    return (
        <div className={cn("space-y-3 p-4", !folder.selected && "text-muted-foreground")}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Checkbox checked={folder.selected} onCheckedChange={(on) => onChange({ selected: on === true })} aria-label={`Restore ${folder.label}`} />
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate text-sm font-medium">{folder.label}</span>
                {meta && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                        {meta.fileCount.toLocaleString()} {meta.fileCount === 1 ? "file" : "files"} · {formatBytes(meta.totalSize)}
                    </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {moved && (
                        <Button variant="ghost" size="sm" disabled={!folder.selected} onClick={() => onChange({ targetConfigId: origin.configId, targetPath: origin.path, checkStatus: undefined })} title={`${origin.configName}: ${origin.path}`}>
                            <RotateCcw />
                            Put back where it was
                        </Button>
                    )}
                    <Button variant="outline" size="sm" disabled={!folder.selected} aria-expanded={!!folder.showTree} onClick={() => onChange({ showTree: !folder.showTree })}>
                        <ListTree />
                        {folder.selection === null ? "All files" : `${folder.selection.length} ${folder.selection.length === 1 ? "path" : "paths"} picked`}
                        <ChevronDown className={cn("transition-transform", folder.showTree && "rotate-180")} />
                    </Button>
                </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center md:pl-7">
                <ConnectionPicker
                    kind="directory"
                    options={targets}
                    value={folder.targetConfigId}
                    onChange={(id) => onChange({ targetConfigId: id, checkStatus: undefined })}
                    placeholder="Pick a directory source"
                    disabled={!folder.selected}
                    aria-label={`Where ${folder.label} goes`}
                />
                <div className="flex min-w-0 gap-2">
                    <Input
                        value={folder.targetPath}
                        onChange={(event) => onChange({ targetPath: event.target.value, checkStatus: undefined })}
                        placeholder={shape.flat ? `${shape.noun}-name` : "/restore/path"}
                        className="font-mono text-sm"
                        disabled={!folder.selected}
                        aria-label={`Path of ${folder.label}`}
                    />
                    <Button variant="outline" size="icon" className="shrink-0" disabled={!folder.selected || !folder.targetConfigId} onClick={onBrowse} aria-label={shape.flat ? `Pick a ${shape.noun}` : "Browse folders"}>
                        {shape.flat ? <HardDrive /> : <FolderOpen />}
                    </Button>
                </div>
                <FolderOutcomeTag outcome={folderOutcome(folder, shape.flat)} shape={shape} />
            </div>
            {folder.showTree && folder.selected && (
                <div className="md:pl-7">
                    <ArchiveFileTree destinationId={destinationId} file={file} jobSourceId={folder.entryId} selection={folder.selection} onSelectionChange={(selection) => onChange({ selection })} profileIdOverride={profileIdOverride} />
                </div>
            )}
        </div>
    );
}
