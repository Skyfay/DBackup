"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { createColumns, FileInfo } from "./columns";
import { RestoreDialog } from "@/components/dashboard/storage/restore-dialog";

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
    const [sources, setSources] = useState<AdapterConfig[]>([]);
    const [selectedDestination, setSelectedDestination] = useState<string>("");
    const [open, setOpen] = useState(false);

    const [files, setFiles] = useState<FileInfo[]>([]);
    const [loading, setLoading] = useState(false);

    // Delete Confirmation State
    const [fileToDelete, setFileToDelete] = useState<FileInfo | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Restore State
    const [restoreFile, setRestoreFile] = useState<FileInfo | null>(null);

    useEffect(() => {
        fetchAdapters();
    }, []);

    useEffect(() => {
        if (selectedDestination) {
            fetchFiles(selectedDestination);
        } else {
            setFiles([]);
        }
    }, [selectedDestination]);

    const fetchAdapters = async () => {
        try {
            const res = await fetch("/api/adapters");
            if (res.ok) {
                const all = await res.json();
                setDestinations(all.filter((a: AdapterConfig) => a.type === "storage"));
                setSources(all.filter((a: AdapterConfig) => a.type === "database"));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchFiles = async (destId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/storage/${destId}/files`);
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
        setRestoreFile(file);
    }, [canRestore]);

    const handleDeleteClick = useCallback((file: FileInfo) => {
        if (!canDelete) {
            toast.error("Permission denied");
            return;
        }
        setFileToDelete(file);
    }, [canDelete]);

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
                fetchFiles(selectedDestination); // Refresh list
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

    const columns = useMemo(() => createColumns({
        onRestore: handleRestoreClick,
        onDownload: handleDownload,
        onDelete: handleDeleteClick,
        canDownload,
        canRestore,
        canDelete
    }), [handleRestoreClick, handleDownload, handleDeleteClick, canDownload, canRestore, canDelete]);

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

            <div className="flex items-center space-x-4">
                <div className="w-[300px]">
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
                        <PopoverContent className="w-[300px] p-0">
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
                             />
                        )}
                    </CardContent>
                 </Card>
            )}

            <RestoreDialog
                open={!!restoreFile}
                onOpenChange={(v) => !v && setRestoreFile(null)}
                file={restoreFile}
                destinationId={selectedDestination}
                sources={sources}
                onSuccess={() => {
                    setRestoreFile(null);
                }}
            />

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
        </div>
    );
}
