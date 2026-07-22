"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    ChevronRight, ChevronDown, Folder, FileText, Download, Undo2, HardDrive, AlertTriangle,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { DateDisplay } from "@/components/utils/date-display";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "FileBrowserModal" });

interface DirectorySource {
    jobSourceId: string;
    label: string;
    fileCount: number;
    totalSize: number;
}

interface BrowseEntry {
    name: string;
    path: string;
    type: "directory" | "file";
    size: number;
    mtime?: string;
    fileCount?: number;
}

interface StorageOption {
    id: string;
    name: string;
}

type RestoreTargetKind = "download" | "origin" | "storage";

interface FileBrowserModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Storage adapter config holding the backup. */
    destinationId: string;
    /** Remote path of the backup archive. */
    file: string;
    fileName: string;
    /** Storage adapters available as a restore destination. */
    storageDestinations: StorageOption[];
    canRestore: boolean;
    canDownload: boolean;
}

/**
 * Browses the files inside a backup and restores a selection of them.
 *
 * Levels are fetched one at a time as folders are expanded. A backup can hold hundreds of
 * thousands of files, so loading the whole tree up front would be far more expensive than
 * the handful of small requests lazy expansion costs.
 */
export function FileBrowserModal({
    open, onOpenChange, destinationId, file, fileName, storageDestinations, canRestore, canDownload,
}: FileBrowserModalProps) {
    const [sources, setSources] = useState<DirectorySource[]>([]);
    const [activeSource, setActiveSource] = useState<string>("");
    const [levels, setLevels] = useState<Record<string, BrowseEntry[]>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const [loadingSources, setLoadingSources] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [targetKind, setTargetKind] = useState<RestoreTargetKind>("download");
    const [targetConfigId, setTargetConfigId] = useState<string>("");
    const [targetPath, setTargetPath] = useState<string>("/restore");
    const [restoring, setRestoring] = useState(false);

    const levelKey = useCallback((src: string, prefix: string) => `${src}::${prefix}`, []);

    const browse = useCallback(async (src: string, prefix: string) => {
        const key = levelKey(src, prefix);
        setLoadingPaths((prev) => new Set(prev).add(key));
        try {
            const res = await fetch(`/api/storage/${destinationId}/browse-archive`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file, jobSourceId: src, prefix: prefix || undefined }),
            });
            const body = await res.json();
            if (!body.success) throw new Error(body.error || "Failed to browse backup");
            setLevels((prev) => ({ ...prev, [key]: body.data.entries }));
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            log.error("Failed to browse backup level", { file, src, prefix });
            toast.error(message);
        } finally {
            setLoadingPaths((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    }, [destinationId, file, levelKey]);

    // Load the directory sources once the dialog opens, then auto-open the first one.
    useEffect(() => {
        if (!open) return;

        setSources([]);
        setActiveSource("");
        setLevels({});
        setExpanded(new Set());
        setSelected(new Set());
        setError(null);
        setLoadingSources(true);

        (async () => {
            try {
                const res = await fetch(`/api/storage/${destinationId}/browse-archive`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ file }),
                });
                const body = await res.json();
                if (!body.success) throw new Error(body.error || "Failed to open backup");

                setSources(body.data.sources);
                if (body.data.sources.length > 0) {
                    setActiveSource(body.data.sources[0].jobSourceId);
                }
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setLoadingSources(false);
            }
        })();
    }, [open, destinationId, file]);

    useEffect(() => {
        if (activeSource && !levels[levelKey(activeSource, "")]) {
            void browse(activeSource, "");
        }
    }, [activeSource, levels, levelKey, browse]);

    const toggleExpand = (entry: BrowseEntry) => {
        const key = levelKey(activeSource, entry.path);
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(entry.path)) next.delete(entry.path);
            else next.add(entry.path);
            return next;
        });
        if (!levels[key]) void browse(activeSource, entry.path);
    };

    const toggleSelect = (entry: BrowseEntry) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(entry.path)) next.delete(entry.path);
            else next.add(entry.path);
            return next;
        });
    };

    /**
     * A path is covered when it or any ancestor is selected. Selecting a folder implies
     * everything beneath it, so its children render as checked without being listed
     * individually - which also keeps the request payload small for huge folders.
     */
    const isCovered = useCallback((path: string): boolean => {
        if (selected.has(path)) return true;
        for (const candidate of selected) {
            if (path.startsWith(`${candidate}/`)) return true;
        }
        return false;
    }, [selected]);

    const selectedSummary = useMemo(() => {
        const root = levels[levelKey(activeSource, "")] ?? [];
        const topLevelSelected = root.filter((e) => selected.has(e.path));
        const bytes = topLevelSelected.reduce((sum, e) => sum + e.size, 0);
        return { count: selected.size, bytes };
    }, [selected, levels, activeSource, levelKey]);

    const renderLevel = (prefix: string, depth: number) => {
        const key = levelKey(activeSource, prefix);
        const entries = levels[key];

        if (loadingPaths.has(key)) {
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
                            checked={covered}
                            // A child of a selected folder is already included, so it cannot
                            // be individually unchecked - clear the folder instead.
                            disabled={covered && !selected.has(entry.path)}
                            onCheckedChange={() => toggleSelect(entry)}
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
                        {entry.mtime && (
                            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                                <DateDisplay date={entry.mtime} />
                            </span>
                        )}
                    </div>

                    {entry.type === "directory" && isOpen && renderLevel(entry.path, depth + 1)}
                </div>
            );
        });
    };

    const submit = async () => {
        if (selected.size === 0) return;

        const target = targetKind === "storage"
            ? { kind: "storage" as const, configId: targetConfigId, basePath: targetPath }
            : { kind: targetKind };

        setRestoring(true);
        try {
            const body = {
                file,
                selections: [{ src: activeSource, paths: [...selected] }],
                target,
            };

            if (targetKind === "download") {
                // Streamed by the server, so the browser saves it as it arrives rather than
                // waiting for the whole selection to be assembled first.
                const res = await fetch(`/api/storage/${destinationId}/restore-files`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                if (!res.ok) {
                    const failure = await res.json().catch(() => ({ error: "Download failed" }));
                    throw new Error(failure.error || "Download failed");
                }

                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `${fileName.replace(/\.[^.]+$/, "")}-files.tar.gz`;
                anchor.click();
                URL.revokeObjectURL(url);
                toast.success("Download started");
                onOpenChange(false);
                return;
            }

            const res = await fetch(`/api/storage/${destinationId}/restore-files`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await res.json();

            if (result.success) {
                toast.success(result.message);
                onOpenChange(false);
            } else if (result.data) {
                toast.warning(result.message, {
                    description: result.data.failed.slice(0, 3).map((f: { path: string }) => f.path).join(", "),
                });
            } else {
                throw new Error(result.error || "Restore failed");
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setRestoring(false);
        }
    };

    const targetValid = targetKind !== "storage" || (targetConfigId !== "" && targetPath.trim() !== "");
    const canSubmit = selected.size > 0 && targetValid && !restoring
        && (targetKind === "download" ? canDownload : canRestore);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
                <DialogHeader>
                    <DialogTitle>Browse and restore files</DialogTitle>
                    <DialogDescription>
                        Pick individual files or folders from <span className="font-medium">{fileName}</span>.
                        Only what you select is read from the backup.
                    </DialogDescription>
                </DialogHeader>

                {error ? (
                    <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                        <p className="text-sm">{error}</p>
                    </div>
                ) : loadingSources ? (
                    <div className="space-y-2 py-4">
                        <Skeleton className="h-5 w-56" />
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-5 w-48" />
                    </div>
                ) : sources.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                        This backup contains no directory sources, so there are no files to browse.
                    </p>
                ) : (
                    <>
                        {sources.length > 1 && (
                            <div className="flex flex-wrap gap-2">
                                {sources.map((source) => (
                                    <Button
                                        key={source.jobSourceId}
                                        type="button"
                                        variant={activeSource === source.jobSourceId ? "secondary" : "ghost"}
                                        size="sm"
                                        onClick={() => {
                                            setActiveSource(source.jobSourceId);
                                            setSelected(new Set());
                                            setExpanded(new Set());
                                        }}
                                    >
                                        {source.label}
                                        <Badge variant="outline" className="ml-2">{source.fileCount}</Badge>
                                    </Button>
                                ))}
                            </div>
                        )}

                        <ScrollArea className="min-h-0 flex-1 rounded-md border">
                            <div className="p-2">{renderLevel("", 0)}</div>
                        </ScrollArea>

                        <Separator />

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>Restore to</Label>
                                <span className="text-sm text-muted-foreground">
                                    {selectedSummary.count === 0
                                        ? "Nothing selected"
                                        : `${selectedSummary.count} item${selectedSummary.count === 1 ? "" : "s"} selected`}
                                </span>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-3">
                                <Button
                                    type="button"
                                    variant={targetKind === "download" ? "secondary" : "outline"}
                                    onClick={() => setTargetKind("download")}
                                    disabled={!canDownload}
                                >
                                    <Download className="mr-2 h-4 w-4" />
                                    Download
                                </Button>
                                <Button
                                    type="button"
                                    variant={targetKind === "origin" ? "secondary" : "outline"}
                                    onClick={() => setTargetKind("origin")}
                                    disabled={!canRestore}
                                >
                                    <Undo2 className="mr-2 h-4 w-4" />
                                    Original location
                                </Button>
                                <Button
                                    type="button"
                                    variant={targetKind === "storage" ? "secondary" : "outline"}
                                    onClick={() => setTargetKind("storage")}
                                    disabled={!canRestore}
                                >
                                    <HardDrive className="mr-2 h-4 w-4" />
                                    Other destination
                                </Button>
                            </div>

                            {targetKind === "origin" && (
                                <p className="text-sm text-muted-foreground">
                                    Files are written back to the path they were collected from, overwriting what is there now.
                                </p>
                            )}

                            {targetKind === "storage" && (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <Select value={targetConfigId} onValueChange={setTargetConfigId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a destination" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {storageDestinations.map((destination) => (
                                                <SelectItem key={destination.id} value={destination.id}>
                                                    {destination.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        value={targetPath}
                                        onChange={(e) => setTargetPath(e.target.value)}
                                        placeholder="/restore"
                                        aria-label="Target path"
                                    />
                                </div>
                            )}
                        </div>
                    </>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restoring}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={!canSubmit}>
                        {restoring ? "Restoring..." : targetKind === "download" ? "Download selection" : "Restore selection"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
