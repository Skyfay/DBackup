"use client";

import { useState } from "react";
import { Check, Download, Filter, FolderOpen, Layers } from "lucide-react";
import { FolderPickerDialog } from "@/components/dashboard/storage/folder-picker-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatBytes } from "@/lib/utils";
import { folderOutcome, type FolderOutcome } from "./restore-model";
import { FolderOutcomeTag, FolderRow } from "./folder-rows";
import { LinesView, type Line } from "./restore-lines";
import { Notice } from "./restore-parts";
import type { ChainInfo, DirectoryAnalysis } from "./use-restore-analysis";
import type { RestoreFolders } from "./use-restore-folders";

/** The archives an incremental snapshot reads, as the F and i boxes of the details of a backup. */
function ChainLine({ chain }: { chain: ChainInfo }) {
    const count = chain.index + 1;
    return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
            <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex gap-1" aria-hidden="true">
                {Array.from({ length: Math.min(count, 12) }, (_, index) => (
                    <span key={index} className={cn("inline-flex h-5 w-6 items-center justify-center rounded-md border bg-muted text-[11px] font-semibold", index === count - 1 && "border-foreground")}>
                        {index === 0 ? "F" : "i"}
                    </span>
                ))}
            </span>
            <span className="font-medium">{chain.type === "incremental" ? `Snapshot ${count} of its chain` : "The full backup of its chain"}</span>
            {chain.deps.length > 0 && <span className="text-muted-foreground">a restore reads {chain.deps.length + 1} archives of the chain by itself</span>}
        </div>
    );
}

const LINE_TONE: Record<FolderOutcome, Line["tone"]> = { replaces: "warning", emptied: "warning", empty: "success", checking: "muted", unverified: "muted", incomplete: null, out: null };
const LINE_LABEL: Record<FolderOutcome, string> = {
    replaces: "replaces files of the same name", emptied: "empties it first", empty: "into an empty folder", checking: "checking", unverified: "not checked", incomplete: "needs a target", out: "stays out",
};

interface FolderStepProps {
    folders: RestoreFolders;
    directories: DirectoryAnalysis[];
    chain: ChainInfo | null;
    file: string;
    destinationId: string;
    canDownload: boolean;
    profileIdOverride?: string;
    view: "table" | "lines";
    /** The switch to the lines, at the end of the head. */
    toolbarEnd?: React.ReactNode;
}

/**
 * The folders of a backup: where each one goes, the files picked in its tree, the patterns left out
 * for all of them, and how much the pick holds. As rows to change them, or as lines to look.
 */
export function FolderStep({ folders, directories, chain, file, destinationId, canDownload, profileIdOverride, view, toolbarEnd }: FolderStepProps) {
    const { targets, change, shapeOf, presets, presetIds, setPresetIds, custom, setCustom, excludePatterns, plan, planError, selections, downloadSelection } = folders;
    const [browsing, setBrowsing] = useState<string | null>(null);
    const editing = folders.folders.find((folder) => folder.entryId === browsing);
    const editingTarget = targets.find((target) => target.id === editing?.targetConfigId);
    const metaOf = (entryId: string) => directories.find((directory) => directory.jobSourceId === entryId);
    const picked = folders.folders.filter((folder) => folder.selected).length;

    const lines: Line[] = folders.folders.map((folder) => {
        const shape = shapeOf(folder.targetConfigId);
        const outcome = folderOutcome(folder, shape.flat);
        const meta = metaOf(folder.entryId);
        const target = targets.find((entry) => entry.id === folder.targetConfigId);
        return {
            key: folder.entryId,
            tone: LINE_TONE[outcome],
            dashed: outcome === "empty",
            label: LINE_LABEL[outcome],
            dim: outcome === "out",
            left: (
                <span className="flex min-w-0 items-center gap-2">
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate text-sm font-semibold">{folder.label}</span>
                    {meta && <span className="truncate text-xs text-muted-foreground">{meta.fileCount.toLocaleString()} files · {formatBytes(meta.totalSize)}</span>}
                </span>
            ),
            right: (
                <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{target?.name ?? "No target yet"}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">{folder.targetPath || "no path"}</span>
                    </span>
                    <FolderOutcomeTag outcome={outcome} shape={shape} />
                </span>
            ),
        };
    });

    return (
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-start gap-3 px-4 pt-4 md:px-5">
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Folders</h3>
                    <p className="text-sm text-muted-foreground">Back where they were by default, or anywhere a directory source reaches</p>
                </div>
                {toolbarEnd}
            </div>
            <div className="space-y-3 p-4 md:px-5">
                {chain && <ChainLine chain={chain} />}
                {planError && <Notice tone="destructive" title="These files cannot be restored">{planError}</Notice>}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5">
                    <Filter className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm font-medium">Leave out</span>
                    {presets.map((preset) => {
                        const on = presetIds.includes(preset.id);
                        return (
                            <button
                                key={preset.id}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setPresetIds(on ? presetIds.filter((id) => id !== preset.id) : [...presetIds, preset.id])}
                                className={cn(
                                    "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                                    on ? "border-foreground/20 bg-muted text-foreground" : "border-dashed text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {on && <Check className="size-3" aria-hidden="true" />}
                                {preset.name}
                            </button>
                        );
                    })}
                    <Input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="*.tmp, cache/**" className="h-7 w-48 font-mono text-xs" aria-label="More patterns to leave out" />
                    <span className="text-xs text-muted-foreground sm:ml-auto">{excludePatterns.length > 0 ? `${excludePatterns.length} patterns, like those of a backup` : "the same patterns as a backup"}</span>
                </div>
            </div>
            {view === "lines" ? (
                <div className="px-4 pb-4 md:px-5">
                    <LinesView lines={lines} />
                </div>
            ) : (
                <div className="divide-y border-t">
                    {folders.folders.map((folder) => (
                        <FolderRow
                            key={folder.entryId}
                            folder={folder}
                            meta={metaOf(folder.entryId)}
                            targets={targets}
                            shape={shapeOf(folder.targetConfigId)}
                            file={file}
                            destinationId={destinationId}
                            profileIdOverride={profileIdOverride}
                            onChange={(patch) => change(folder.entryId, patch)}
                            onBrowse={() => setBrowsing(folder.entryId)}
                        />
                    ))}
                </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
                <span className="tabular-nums">
                    {picked} of {folders.folders.length} picked{plan ? ` · ${plan.fileCount.toLocaleString()} ${plan.fileCount === 1 ? "file" : "files"}, ${formatBytes(plan.totalBytes)}` : ""}
                </span>
                {plan?.fullDownload && <span className="text-warning">This destination cannot read parts of a file, so the restore reads the whole archive once</span>}
                {canDownload && (
                    <Button variant="outline" size="sm" className="sm:ml-auto" disabled={selections.length === 0 || !!planError} onClick={() => void downloadSelection()}>
                        <Download />
                        Download the picked files
                    </Button>
                )}
            </div>
            {editing && editingTarget && (
                <FolderPickerDialog
                    open
                    onOpenChange={(open) => !open && setBrowsing(null)}
                    configId={editingTarget.id}
                    configName={editingTarget.name}
                    flat={shapeOf(editingTarget.id).flat}
                    itemNoun={shapeOf(editingTarget.id).noun}
                    onSelect={(path) => change(editing.entryId, { targetPath: path, checkStatus: undefined })}
                />
            )}
        </section>
    );
}
