"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
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

    const handleDownload = useCallback((file: FileInfo) => {
        if (!canDownload) {
            toast.error("Permission denied");
            return;
        }
        // Trigger download via API
        const url = `/api/storage/${selectedDestination}/download?file=${encodeURIComponent(file.path)}`;
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

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">Storage Explorer</h2>

            <div className="flex items-center space-x-4">
                <div className="w-[300px]">
                    <Select value={selectedDestination} onValueChange={setSelectedDestination}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select Destination" />
                        </SelectTrigger>
                        <SelectContent>
                            {destinations.map(d => (
                                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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
                             <DataTable columns={columns} data={files} />
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
