"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, File, ArrowUp, Loader2, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface FileEntry {
    name: string;
    type: "directory" | "file";
    path: string;
}

interface FileBrowserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (path: string) => void;
    initialPath?: string;
    selectionType?: "file" | "directory" | "all";
    title?: string;
    remoteConfig?: any; // If provided, uses remote API
}

export function FileBrowserDialog({
    open,
    onOpenChange,
    onSelect,
    initialPath = "/",
    selectionType = "all",
    title = "Select File or Directory",
    remoteConfig
}: FileBrowserDialogProps) {
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);

    // Initial load
    useEffect(() => {
        if (open) {
            // eslint-disable-next-line react-hooks/exhaustive-deps
            fetchPath(currentPath);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const fetchPath = async (path: string) => {
        setLoading(true);
        try {
            let res;
            if (remoteConfig) {
                 res = await fetch(`/api/system/filesystem/remote`, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ config: remoteConfig, path })
                 });
            } else {
                 const params = new URLSearchParams({ path });
                 res = await fetch(`/api/system/filesystem?${params.toString()}`);
            }

            const json = await res.json();

            if (json.success) {
                setEntries(json.data.entries);
                setCurrentPath(json.data.currentPath);
                setParentPath(json.data.parentPath);
                setSelectedEntry(null);
            } else {
                toast.error(json.error || "Failed to load directory");
                // If path invalid (e.g. initial path), fallback to root
                if (path !== "/") {
                    fetchPath("/");
                }
            }
        } catch (_error) {
            toast.error("Network error");
        } finally {
            setLoading(false);
        }
    };

    const handleEntryClick = (entry: FileEntry) => {
        setSelectedEntry(entry);
    };

    const handleEntryDoubleClick = (entry: FileEntry) => {
        if (entry.type === "directory") {
            fetchPath(entry.path);
        } else if (selectionType !== "directory") {
            // Select file on double click
            onSelect(entry.path);
            onOpenChange(false);
        }
    };

    const handleUp = async () => {
         if (parentPath && parentPath !== currentPath) {
             fetchPath(parentPath);
         } else {
             // Fallback to naive splitting if API didn't return parent (should not happen)
             const parent = currentPath.split(/[/\\]/).slice(0, -1).join('/') || '/';
             fetchPath(parent);
         }
    };

    const handleConfirm = () => {
        if (!selectedEntry) {
            // If selecting a directory and nothing specific selected, maybe user wants current path?
            // Usually user selects an entry.
            // If selectionType is directory and nothing selected, return currentPath?
            if (selectionType === 'directory') {
                onSelect(currentPath);
                onOpenChange(false);
                return;
            }
            return;
        }

        if (selectionType === "directory" && selectedEntry.type !== "directory") {
            toast.error("Please select a directory");
            return;
        }

        if (selectionType === "file" && selectedEntry.type !== "file") {
            // If it's a directory, enter it instead of selecting
            fetchPath(selectedEntry.path);
            return;
        }

        onSelect(selectedEntry.path);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 pb-2 border-b">
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                {/* Toolbar */}
                <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                    <Button variant="ghost" size="icon" onClick={() => fetchPath("/")} title="Root">
                        <Home className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleUp} disabled={currentPath === "/"} title="Up">
                        <ArrowUp className="h-4 w-4" />
                    </Button>
                    <form
                        className="flex-1"
                        onSubmit={(e) => { e.preventDefault(); fetchPath(currentPath); }}
                    >
                        <Input
                            value={currentPath}
                            onChange={(e) => setCurrentPath(e.target.value)}
                            className="h-8 text-sm font-mono"
                        />
                    </form>
                </div>

                {/* File List */}
                <ScrollArea className="flex-1 min-h-0 p-2">
                    {loading ? (
                        <div className="flex h-full items-center justify-center min-h-[300px]">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-1">
                            {entries.length === 0 && (
                                <div className="text-center text-muted-foreground py-8 text-sm">
                                    Empty directory
                                </div>
                            )}
                            {entries.map((entry) => (
                                <div
                                    key={entry.path}
                                    className={cn(
                                        "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors",
                                        selectedEntry?.path === entry.path
                                            ? "bg-accent text-accent-foreground font-medium"
                                            : "hover:bg-muted/50"
                                    )}
                                    onClick={() => handleEntryClick(entry)}
                                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                                >
                                    {entry.type === "directory" ? (
                                        <Folder className={cn("h-4 w-4 text-blue-500", selectedEntry?.path === entry.path && "fill-blue-500/20")} />
                                    ) : (
                                        <File className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <span className="truncate flex-1">{entry.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                <DialogFooter className="p-4 border-t bg-muted/10">
                    <div className="flex items-center justify-between w-full">
                         <div className="text-xs text-muted-foreground max-w-[60%] truncate">
                            {selectedEntry ? (
                                <>Selected: <span className="font-mono">{selectedEntry.name}</span></>
                            ) : selectionType === 'directory' ? (
                                <>Current: <span className="font-mono">{currentPath}</span></>
                            ) : null}
                         </div>
                         <div className="flex gap-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                            <Button onClick={handleConfirm} disabled={loading || (!selectedEntry && selectionType !== 'directory')}>
                                Select
                            </Button>
                         </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
