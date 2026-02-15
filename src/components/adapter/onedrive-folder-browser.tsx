"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, ArrowUp, Loader2, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface FolderEntry {
    name: string;
    type: "directory";
    path: string; // OneDrive path like /backups/mysql
}

interface OneDriveFolderBrowserProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (folderPath: string) => void;
    config: {
        clientId: string;
        clientSecret: string;
        refreshToken: string;
    };
    initialPath?: string;
}

/**
 * OneDrive folder browser dialog.
 * Lets users navigate their OneDrive folder structure and select a target folder.
 * Uses OneDrive paths (e.g. /backups/mysql).
 */
export function OneDriveFolderBrowser({
    open,
    onOpenChange,
    onSelect,
    config,
    initialPath,
}: OneDriveFolderBrowserProps) {
    const [currentPath, setCurrentPath] = useState(initialPath || "");
    const [_currentName, setCurrentName] = useState("OneDrive (Root)");
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [entries, setEntries] = useState<FolderEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<FolderEntry | null>(null);

    useEffect(() => {
        if (open) {
            const startPath = initialPath || "";
            setCurrentPath(startPath);
            fetchFolder(startPath);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const fetchFolder = async (folderPath: string) => {
        setLoading(true);
        try {
            const res = await fetch("/api/system/filesystem/onedrive", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config, folderPath }),
            });

            const json = await res.json();

            if (json.success) {
                setEntries(json.data.entries);
                setCurrentPath(json.data.currentPath);
                setCurrentName(json.data.currentName);
                setParentPath(json.data.parentPath);
                setSelectedEntry(null);
            } else {
                toast.error(json.error || "Failed to load OneDrive folders");
            }
        } catch {
            toast.error("Network error while browsing OneDrive");
        } finally {
            setLoading(false);
        }
    };

    const navigateToFolder = (folderPath: string) => {
        fetchFolder(folderPath);
    };

    const handleEntryClick = (entry: FolderEntry) => {
        setSelectedEntry(entry);
    };

    const handleEntryDoubleClick = (entry: FolderEntry) => {
        navigateToFolder(entry.path);
    };

    const handleUp = () => {
        if (parentPath !== null) {
            navigateToFolder(parentPath);
        }
    };

    const handleConfirm = () => {
        if (selectedEntry) {
            onSelect(selectedEntry.path);
        } else {
            onSelect(currentPath);
        }
        onOpenChange(false);
    };

    // Build breadcrumbs from the current path
    const breadcrumbs = (() => {
        const parts = currentPath.split("/").filter(Boolean);
        const crumbs = [{ name: "OneDrive", path: "" }];
        let accumulated = "";
        for (const part of parts) {
            accumulated += "/" + part;
            crumbs.push({ name: part, path: accumulated });
        }
        return crumbs;
    })();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 pb-2 border-b">
                    <DialogTitle>Select OneDrive Folder</DialogTitle>
                </DialogHeader>

                {/* Toolbar */}
                <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigateToFolder("")}
                        title="OneDrive Root"
                    >
                        <Home className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleUp}
                        disabled={parentPath === null}
                        title="Up"
                    >
                        <ArrowUp className="h-4 w-4" />
                    </Button>

                    {/* Breadcrumbs */}
                    <div className="flex-1 flex items-center gap-1 overflow-x-auto text-sm">
                        {breadcrumbs.map((crumb, i) => (
                            <span key={crumb.path} className="flex items-center gap-1 shrink-0">
                                {i > 0 && (
                                    <span className="text-muted-foreground">/</span>
                                )}
                                <button
                                    type="button"
                                    className={cn(
                                        "px-1.5 py-0.5 rounded hover:bg-muted transition-colors truncate max-w-[150px]",
                                        i === breadcrumbs.length - 1
                                            ? "font-medium text-foreground"
                                            : "text-muted-foreground"
                                    )}
                                    onClick={() => navigateToFolder(crumb.path)}
                                >
                                    {crumb.name}
                                </button>
                            </span>
                        ))}
                    </div>
                </div>

                {/* Folder list */}
                <ScrollArea className="flex-1 p-2">
                    {loading ? (
                        <div className="flex items-center justify-center h-full py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Folder className="h-12 w-12 mb-2 opacity-30" />
                            <p className="text-sm">No subfolders</p>
                            <p className="text-xs mt-1">You can select the current folder</p>
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {entries.map((entry) => (
                                <button
                                    key={entry.path}
                                    type="button"
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left",
                                        selectedEntry?.path === entry.path
                                            ? "bg-primary/10 text-primary border border-primary/20"
                                            : "hover:bg-muted"
                                    )}
                                    onClick={() => handleEntryClick(entry)}
                                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                                >
                                    <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="truncate">{entry.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                {/* Footer */}
                <DialogFooter className="p-4 pt-2 border-t gap-2">
                    <div className="flex-1 text-xs text-muted-foreground truncate">
                        {selectedEntry
                            ? `Selected: ${selectedEntry.path}`
                            : `Current: ${currentPath || "/ (Root)"}`}
                    </div>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm}>
                        Select Folder
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
