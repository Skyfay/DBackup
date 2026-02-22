"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DataTable } from "@/components/ui/data-table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getColumns, FileInfo } from "./columns";
import { lockBackup } from "@/app/actions/storage/lock";
import { DownloadLinkModal } from "@/components/dashboard/storage/download-link-modal";

interface AdapterConfig {
    id: string;
    originalId: string;
    name: string;
    type: string;
    adapterId: string;
}

interface StorageClientProps {
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
}

export function StorageClient({ canDownload, canRestore, canDelete }: StorageClientProps) {
    const [destinations, setDestinations] = useState<AdapterConfig[]>([]);
    const [selectedDestination, setSelectedDestination] = useState<string>("");
    const [open, setOpen] = useState(false);
    const router = useRouter();

    // Filter State
    const [showSystemConfigs, setShowSystemConfigs] = useState(false);

    const [files, setFiles] = useState<FileInfo[]>([]);
    const [loading, setLoading] = useState(false);

    // Delete Confirmation State
    const [fileToDelete, setFileToDelete] = useState<FileInfo | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Download Link Modal State
    const [downloadLinkFile, setDownloadLinkFile] = useState<FileInfo | null>(null);

    useEffect(() => {
        fetchAdapters();
    }, []);

    useEffect(() => {
        if (selectedDestination) {
            fetchFiles(selectedDestination, showSystemConfigs);
        } else {
            setFiles([]);
        }
    }, [selectedDestination, showSystemConfigs]);

    const fetchAdapters = async () => {
        try {
            const storageRes = await fetch("/api/adapters?type=storage");
            if (storageRes.ok) {
                const storageData = await storageRes.json();
                setDestinations(storageData);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchFiles = async (destId: string, showSystem: boolean) => {
        setLoading(true);
        try {
            const typeFilter = showSystem ? "SYSTEM" : "BACKUP";
            const res = await fetch(`/api/storage/${destId}/files?typeFilter=${typeFilter}`);
            if (res.ok) {
                setFiles(await res.json());
            } else {
                 const data = await res.json();
                 toast.error(data.error || "Failed to fetch files");
            }
        } catch {
            toast.error("Error fetching files");
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = useCallback((file: FileInfo, decrypt?: boolean) => {
        if (!canDownload) {
            toast.error("Permission denied");
            return;
        }
        // Trigger download via API
        let url = `/api/storage/${selectedDestination}/download?file=${encodeURIComponent(file.path)}`;
        if (decrypt) {
            url += "&decrypt=true";
        }
        window.open(url, '_blank');
    }, [canDownload, selectedDestination]);

    const handleRestoreClick = useCallback((file: FileInfo) => {
        if (!canRestore) {
            toast.error("Permission denied");
            return;
        }
        const encoded = btoa(JSON.stringify(file));
        router.push(`/dashboard/storage/restore?destinationId=${encodeURIComponent(selectedDestination)}&file=${encodeURIComponent(encoded)}`);
    }, [canRestore, selectedDestination, router]);

    const handleDeleteClick = useCallback((file: FileInfo) => {
        if (!canDelete) {
            toast.error("Permission denied");
            return;
        }
        setFileToDelete(file);
    }, [canDelete]);

    const handleToggleLock = useCallback(async (file: FileInfo) => {
        // Optimistic update or simple refresh?
        // Simple refresh for safety
        try {
            const result = await lockBackup(selectedDestination, file.path);
            if (result.success) {
                toast.success(result.locked ? "Backup locked (Safe from retention)" : "Backup unlocked");
                // Refresh list to update the lock icon
                fetchFiles(selectedDestination, showSystemConfigs);
            } else {
                toast.error(result.error || "Failed to toggle lock");
            }
        } catch (_e) {
            toast.error("An error occurred while toggling lock");
        }
    }, [selectedDestination, showSystemConfigs]);

    const handleGenerateLink = useCallback((file: FileInfo) => {
        if (!canDownload) {
            toast.error("Permission denied");
            return;
        }
        setDownloadLinkFile(file);
    }, [canDownload]);

    const confirmDelete = async () => {
        if (!fileToDelete) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/storage/${selectedDestination}/files`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: fileToDelete.path }),
            });

            if (res.ok) {
                toast.success("File deleted successfully");
                setFileToDelete(null);
                fetchFiles(selectedDestination, showSystemConfigs); // Refresh list
            } else {
                const data = await res.json();
                toast.error("Failed to delete file: " + (data.error || "Unknown"));
            }
        } catch {
            toast.error("Error deleting file");
        } finally {
            setDeleting(false);
        }
    };

    const columns = useMemo(() => getColumns({
        onRestore: handleRestoreClick,
        onDownload: handleDownload,
        onDelete: handleDeleteClick,
        onToggleLock: handleToggleLock,
        onGenerateLink: handleGenerateLink,
        canDownload,
        canRestore,
        canDelete
    }), [handleRestoreClick, handleDownload, handleDeleteClick, handleToggleLock, handleGenerateLink, canDownload, canRestore, canDelete]);

    const filterableColumns = useMemo(() => {
        const jobs = Array.from(new Set(files.map(f => f.jobName).filter(Boolean).filter(n => n !== "Unknown"))) as string[];
        const types = Array.from(new Set(files.map(f => f.sourceType).filter(Boolean))) as string[];

        return [
            {
                id: "sourceType",
                title: "Source Type",
                options: types.map(t => ({ label: t, value: t }))
            },
            {
                id: "jobName",
                title: "Job",
                options: jobs.map(j => ({ label: j, value: j }))
            }
        ];
    }, [files]);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Storage Explorer</h2>
                <p className="text-muted-foreground">Browse, download, and restore backup files from your destinations.</p>
            </div>

            <div className="flex items-center space-x-4 justify-between">
                <div className="w-75">
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={open}
                                className="w-full justify-between"
                            >
                                {selectedDestination
                                    ? destinations.find((dest) => dest.id === selectedDestination)?.name
                                    : "Select Destination..."}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-75 p-0">
                            <Command>
                                <CommandInput placeholder="Search destination..." />
                                <CommandList>
                                    <CommandEmpty>No destination found.</CommandEmpty>
                                    <CommandGroup>
                                        {destinations.map((destination) => (
                                            <CommandItem
                                                key={destination.id}
                                                value={destination.name}
                                                onSelect={() => {
                                                    setSelectedDestination(destination.id === selectedDestination ? "" : destination.id);
                                                    setOpen(false);
                                                }}
                                            >
                                                <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4",
                                                        selectedDestination === destination.id ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                {destination.name}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="flex items-center space-x-2">
                    <Switch
                        id="show-system-configs"
                        checked={showSystemConfigs}
                        onCheckedChange={setShowSystemConfigs}
                    />
                    <Label htmlFor="show-system-configs">Show System Configs</Label>
                </div>
            </div>

            {selectedDestination && (
                 <Card>
                    <CardHeader>
                        <CardTitle>Backups</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                             <div className="flex justify-center p-8">Loading files...</div>
                        ) : (
                             <DataTable
                                columns={columns}
                                data={files}
                                filterableColumns={filterableColumns}
                                onRefresh={() => selectedDestination && fetchFiles(selectedDestination, showSystemConfigs)}
                             />
                        )}
                    </CardContent>
                 </Card>
            )}

            {/* Restore now uses /dashboard/storage/restore page */}

            {/* Delete Confirmation Modal */}
            <Dialog open={!!fileToDelete} onOpenChange={(o) => { if(!o && !deleting) setFileToDelete(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Backup</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <b>{fileToDelete?.name}</b>?
                            This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setFileToDelete(null)} disabled={deleting}>Cancel</Button>
                        <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
                            {deleting ? "Deleting..." : "Delete Permanently"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Download Link Modal */}
            {downloadLinkFile && (
                <DownloadLinkModal
                    open={!!downloadLinkFile}
                    onOpenChange={(o) => { if (!o) setDownloadLinkFile(null); }}
                    storageId={selectedDestination}
                    file={{
                        name: downloadLinkFile.name,
                        path: downloadLinkFile.path,
                        size: downloadLinkFile.size,
                        isEncrypted: downloadLinkFile.isEncrypted,
                    }}
                />
            )}
        </div>
    );
}
