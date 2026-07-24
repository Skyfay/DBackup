"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Folder, HardDrive, ChevronRight, AlertTriangle } from "lucide-react";

interface BrowseEntry {
    name: string;
    /** Opaque identity for the next browse call - a path for most adapters, an ID for Google Drive. */
    path: string;
}

/** One level of the navigation stack. */
interface Crumb {
    name: string;
    /** What the browse API needs to list this level. */
    browsePath: string;
}

interface FolderPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Storage adapter config to browse. */
    configId: string;
    configName: string;
    /** Called with the chosen folder path, relative to the adapter's root. */
    onSelect: (path: string) => void;
}

/**
 * Folder navigation over a storage adapter, for picking a restore target path.
 *
 * Uses the same GET /api/adapters/[id]/browse the job form's source picker uses, but as
 * click-to-descend navigation with a breadcrumb instead of a checkbox tree - a restore
 * target is exactly one folder.
 *
 * The returned path is the breadcrumb names joined with "/". For path-based adapters that
 * is identical to the real relative path; for ID-based adapters (Google Drive) it is the
 * name path, which is what their upload path resolution expects.
 */
export function FolderPickerDialog({ open, onOpenChange, configId, configName, onSelect }: FolderPickerDialogProps) {
    const [stack, setStack] = useState<Crumb[]>([]);
    const [entries, setEntries] = useState<BrowseEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [unsupported, setUnsupported] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadLevel = useCallback(async (browsePath: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/adapters/${configId}/browse?path=${encodeURIComponent(browsePath)}`);
            const body = await res.json();
            if (!body.success) throw new Error(body.error || "Failed to browse folders");
            setUnsupported(body.supported === false);
            setEntries(body.data.entries);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [configId]);

    useEffect(() => {
        if (!open) return;
        setStack([]);
        setUnsupported(false);
        void loadLevel("");
    }, [open, loadLevel]);

    const descend = (entry: BrowseEntry) => {
        setStack((prev) => [...prev, { name: entry.name, browsePath: entry.path }]);
        void loadLevel(entry.path);
    };

    const jumpTo = (depth: number) => {
        const next = stack.slice(0, depth);
        setStack(next);
        void loadLevel(next.length > 0 ? next[next.length - 1].browsePath : "");
    };

    const currentPath = stack.map((c) => c.name).join("/");

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[70vh] max-w-lg flex-col">
                <DialogHeader>
                    <DialogTitle>Choose a folder</DialogTitle>
                    <DialogDescription>
                        Pick the restore target folder on <span className="font-medium">{configName}</span>.
                    </DialogDescription>
                </DialogHeader>

                {/* Breadcrumb */}
                <div className="flex flex-wrap items-center gap-1 text-sm">
                    <button
                        type="button"
                        onClick={() => jumpTo(0)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <HardDrive className="h-3.5 w-3.5" />
                        Root
                    </button>
                    {stack.map((crumb, i) => (
                        <span key={`${crumb.browsePath}-${i}`} className="flex items-center gap-1">
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <button
                                type="button"
                                onClick={() => jumpTo(i + 1)}
                                className="max-w-40 truncate rounded px-1.5 py-0.5 hover:bg-muted"
                            >
                                {crumb.name}
                            </button>
                        </span>
                    ))}
                </div>

                {/* Fixed height rather than flex-1 alone: a folder with many children was
                    growing the list past the dialog and pushing the footer out of view. */}
                <ScrollArea className="h-80 min-h-0 flex-1 rounded-md border">
                    <div className="p-1">
                        {loading ? (
                            <div className="space-y-2 p-2">
                                <Skeleton className="h-5 w-48" />
                                <Skeleton className="h-5 w-36" />
                                <Skeleton className="h-5 w-44" />
                            </div>
                        ) : error ? (
                            <div className="flex items-start gap-2 p-3 text-sm">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                <span>{error}</span>
                            </div>
                        ) : unsupported ? (
                            <p className="p-3 text-sm text-muted-foreground">
                                This adapter does not support folder browsing - type the target path manually instead.
                            </p>
                        ) : entries.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">No subfolders here.</p>
                        ) : (
                            entries.map((entry) => (
                                <button
                                    key={entry.path}
                                    type="button"
                                    onClick={() => descend(entry)}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                                >
                                    <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                                    <span className="truncate">{entry.name}</span>
                                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                                </button>
                            ))
                        )}
                    </div>
                </ScrollArea>

                <DialogFooter className="items-center gap-2 sm:justify-between">
                    <span className="truncate font-mono text-xs text-muted-foreground">
                        /{currentPath}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button
                            disabled={unsupported}
                            onClick={() => {
                                onSelect(`/${currentPath}`.replace(/\/+$/, "") || "/");
                                onOpenChange(false);
                            }}
                        >
                            Select this folder
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
