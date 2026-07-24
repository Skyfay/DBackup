"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, ChevronDown, Folder, FileText } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import {
    ArchiveTreeSelection,
    hasCoveredDescendant as hasCoveredDescendantIn,
    isCovered as isCoveredIn,
    toggleSelection,
} from "./archive-tree-selection";

export type { ArchiveTreeSelection };

interface BrowseEntry {
    name: string;
    path: string;
    type: "directory" | "file";
    size: number;
    mtime?: string;
    fileCount?: number;
}

interface ArchiveFileTreeProps {
    /** Storage adapter config holding the backup. */
    destinationId: string;
    /** Remote path of the backup archive. */
    file: string;
    jobSourceId: string;
    selection: ArchiveTreeSelection;
    onSelectionChange: (selection: ArchiveTreeSelection) => void;
    disabled?: boolean;
}

/**
 * Lazy checkbox tree over a backup's file index, one level per request via
 * POST /api/storage/[id]/browse-archive.
 *
 * A backup can hold hundreds of thousands of files, so the whole tree is never shipped to
 * the browser - levels load as folders expand, and selection semantics are chosen so they
 * never require knowledge of unloaded content: a checked folder simply covers everything
 * beneath it.
 */
export function ArchiveFileTree({
    destinationId, file, jobSourceId, selection, onSelectionChange, disabled,
}: ArchiveFileTreeProps) {
    const [levels, setLevels] = useState<Record<string, BrowseEntry[]>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loadingPrefixes, setLoadingPrefixes] = useState<Set<string>>(new Set());

    const loadLevel = useCallback(async (prefix: string) => {
        setLoadingPrefixes((prev) => new Set(prev).add(prefix));
        try {
            const res = await fetch(`/api/storage/${destinationId}/browse-archive`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file, jobSourceId, prefix: prefix || undefined }),
            });
            const body = await res.json();
            if (!body.success) throw new Error(body.error || "Failed to browse backup");
            setLevels((prev) => ({ ...prev, [prefix]: body.data.entries }));
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setLoadingPrefixes((prev) => {
                const next = new Set(prev);
                next.delete(prefix);
                return next;
            });
        }
    }, [destinationId, file, jobSourceId]);

    useEffect(() => {
        if (!levels[""] && !loadingPrefixes.has("")) void loadLevel("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isCovered = useCallback((path: string) => isCoveredIn(selection, path), [selection]);
    const hasCoveredDescendant = useCallback((path: string) => hasCoveredDescendantIn(selection, path), [selection]);

    const toggle = useCallback((entry: BrowseEntry) => {
        if (disabled) return;
        onSelectionChange(toggleSelection(selection, entry.path, levels));
    }, [disabled, selection, levels, onSelectionChange]);

    const toggleExpand = useCallback((entry: BrowseEntry) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(entry.path)) next.delete(entry.path);
            else next.add(entry.path);
            return next;
        });
        if (!levels[entry.path] && !loadingPrefixes.has(entry.path)) void loadLevel(entry.path);
    }, [levels, loadingPrefixes, loadLevel]);

    const toggleAll = useCallback(() => {
        if (disabled) return;
        onSelectionChange(selection === null ? [] : null);
    }, [disabled, selection, onSelectionChange]);

    const renderLevel = (prefix: string, depth: number) => {
        const entries = levels[prefix];

        if (loadingPrefixes.has(prefix)) {
            return (
                <div className="space-y-2 py-1" style={{ paddingLeft: `${depth * 20 + 28}px` }}>
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-28" />
                </div>
            );
        }
        if (!entries) return null;
        if (entries.length === 0) {
            return (
                <p className="py-1 text-sm text-muted-foreground" style={{ paddingLeft: `${depth * 20 + 28}px` }}>
                    Empty folder
                </p>
            );
        }

        return entries.map((entry) => {
            const covered = isCovered(entry.path);
            const partial = !covered && entry.type === "directory" && hasCoveredDescendant(entry.path);
            const isOpen = expanded.has(entry.path);

            return (
                <div key={entry.path}>
                    <div
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                        style={{ paddingLeft: `${depth * 20 + 8}px` }}
                    >
                        {entry.type === "directory" ? (
                            <button
                                type="button"
                                onClick={() => toggleExpand(entry)}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={isOpen ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                            >
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                        ) : (
                            <span className="w-4" />
                        )}

                        <Checkbox
                            checked={covered ? true : partial ? "indeterminate" : false}
                            disabled={disabled}
                            onCheckedChange={() => toggle(entry)}
                            aria-label={`Select ${entry.name}`}
                        />

                        {entry.type === "directory"
                            ? <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                            : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}

                        <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>

                        {entry.type === "directory" && entry.fileCount !== undefined && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {entry.fileCount} file{entry.fileCount === 1 ? "" : "s"}
                            </span>
                        )}
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {formatBytes(entry.size)}
                        </span>
                    </div>

                    {entry.type === "directory" && isOpen && renderLevel(entry.path, depth + 1)}
                </div>
            );
        });
    };

    const rootEntries = levels[""] ?? [];
    const allState = selection === null
        ? true
        : selection.length === 0
            ? false
            : "indeterminate" as const;

    return (
        <div className="rounded-md border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
                <span className="w-4" />
                <Checkbox
                    checked={allState}
                    disabled={disabled || rootEntries.length === 0}
                    onCheckedChange={toggleAll}
                    aria-label="Select all files"
                />
                <span className="text-sm font-medium">All files</span>
            </div>
            <ScrollArea className="h-72">
                <div className="p-1">
                    {renderLevel("", 0)}
                </div>
            </ScrollArea>
        </div>
    );
}
