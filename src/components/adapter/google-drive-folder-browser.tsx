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
    path: string; // folder ID
}

interface GoogleDriveFolderBrowserProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (folderId: string, folderName: string) => void;
    /** OAUTH credential profile id; credentials are resolved server-side from it. */
    credentialId: string;
    initialFolderId?: string;
}

/**
 * Google Drive folder browser dialog.
 * Lets users navigate their Google Drive folder structure and select a target folder.
 * Uses folder IDs internally, displays folder names to the user.
 */
export function GoogleDriveFolderBrowser({
    open,
    onOpenChange,
    onSelect,
    credentialId,
    initialFolderId,
}: GoogleDriveFolderBrowserProps) {
    const [currentFolderId, setCurrentFolderId] = useState(initialFolderId || "root");
    const [currentName, setCurrentName] = useState("My Drive");
    const [parentFolderId, setParentFolderId] = useState<string | null>(null);
    const [entries, setEntries] = useState<FolderEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<FolderEntry | null>(null);
    const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([
        { id: "root", name: "My Drive" },
    ]);

    useEffect(() => {
        if (open) {
            // Reset to initial state when opening
            const startId = initialFolderId || "root";
            setCurrentFolderId(startId);
            setBreadcrumbs([{ id: "root", name: "My Drive" }]);
            fetchFolder(startId, true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const fetchFolder = async (folderId: string, isInitial = false) => {
        setLoading(true);
        try {
            const res = await fetch("/api/system/filesystem/google-drive", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credentialId, folderId }),
            });

            const json = await res.json();

            if (json.success) {
                setEntries(json.data.entries);
                setCurrentFolderId(json.data.currentPath);
                setCurrentName(json.data.currentName);
                setParentFolderId(json.data.parentPath);
                setSelectedEntry(null);

                // Update breadcrumbs
                if (isInitial) {
                    if (folderId === "root") {
                        setBreadcrumbs([{ id: "root", name: "My Drive" }]);
                    } else {
                        setBreadcrumbs([
                            { id: "root", name: "My Drive" },
                            { id: folderId, name: json.data.currentName },
                        ]);
                    }
                }
            } else {
                toast.error(json.error || "Failed to load Google Drive folders");
            }
        } catch {
            toast.error("Network error while browsing Google Drive");
        } finally {
            setLoading(false);
        }
    };

    const navigateToFolder = (folderId: string, folderName: string) => {
        // Add to breadcrumbs
        const existingIndex = breadcrumbs.findIndex((b) => b.id === folderId);
        if (existingIndex >= 0) {
            // Navigate back to an existing breadcrumb
            setBreadcrumbs(breadcrumbs.slice(0, existingIndex + 1));
        } else {
            setBreadcrumbs([...breadcrumbs, { id: folderId, name: folderName }]);
        }
        fetchFolder(folderId);
    };

    const handleEntryClick = (entry: FolderEntry) => {
        setSelectedEntry(entry);
    };

    const handleEntryDoubleClick = (entry: FolderEntry) => {
        navigateToFolder(entry.path, entry.name);
    };

    const handleUp = () => {
        if (parentFolderId) {
            // Find parent name from breadcrumbs or use generic
            const parentBreadcrumb = breadcrumbs[breadcrumbs.length - 2];
            if (parentBreadcrumb) {
                navigateToFolder(parentBreadcrumb.id, parentBreadcrumb.name);
            } else {
                navigateToFolder(parentFolderId, "...");
            }
        }
    };

    const handleConfirm = () => {
        if (selectedEntry) {
            // User selected a specific subfolder
            onSelect(selectedEntry.path, selectedEntry.name);
        } else {
            // User wants the current folder
            onSelect(
                currentFolderId === "root" ? "" : currentFolderId,
                currentName
            );
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 pb-2 border-b">
                    <DialogTitle>Select Google Drive Folder</DialogTitle>
                </DialogHeader>

                {/* Toolbar */}
                <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigateToFolder("root", "My Drive")}
                        title="My Drive (Root)"
                    >
                        <Home className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleUp}
                        disabled={currentFolderId === "root"}
                        title="Up"
                    >
                        <ArrowUp className="h-4 w-4" />
                    </Button>

                    {/* Breadcrumbs */}
                    <div className="flex-1 flex items-center gap-1 overflow-x-auto text-sm">
                        {breadcrumbs.map((crumb, i) => (
                            <span key={crumb.id} className="flex items-center gap-1 shrink-0">
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
                                    onClick={() => navigateToFolder(crumb.id, crumb.name)}
                                >
                                    {crumb.name}
                                </button>
                            </span>
                        ))}
                    </div>
                </div>

                {/* Folder List */}
                <ScrollArea className="flex-1 min-h-0 p-2">
                    {loading ? (
                        <div className="flex h-full items-center justify-center min-h-[300px]">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-1">
                            {entries.length === 0 && (
                                <div className="text-center text-muted-foreground py-8 text-sm">
                                    No subfolders in this directory
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
                                    <Folder
                                        className={cn(
                                            "h-4 w-4 text-blue-500",
                                            selectedEntry?.path === entry.path && "fill-blue-500/20"
                                        )}
                                    />
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
                                <>
                                    Selected: <span className="font-mono">{selectedEntry.name}</span>
                                </>
                            ) : (
                                <>
                                    Current: <span className="font-mono">{currentName}</span>
                                </>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleConfirm} disabled={loading}>
                                Select
                            </Button>
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
