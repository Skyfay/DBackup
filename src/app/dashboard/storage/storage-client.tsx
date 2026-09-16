"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { SortingState, ColumnFiltersState } from "@tanstack/react-table";
import { ChevronsUpDown, HardDrive, RefreshCw, Trash2, Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { requestBulk } from "@/lib/bulk-request";
import { encodeUrlPayload } from "@/lib/url-payload";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getColumns, FileInfo, RestoreMode } from "./columns";
import { lockBackup } from "@/app/actions/storage/lock";
import { DownloadLinkModal } from "@/components/dashboard/storage/download-link-modal";
import { DatabaseDownloadDialog } from "@/components/dashboard/storage/database-download-dialog";
import { startPreparedArchiveDownload } from "@/components/dashboard/storage/prepared-download";
import { IntegrityModal } from "@/components/dashboard/storage/integrity-modal";
import { StorageHistoryTab } from "@/components/dashboard/storage/storage-history-tab";
import { StorageSettingsTab } from "@/components/dashboard/storage/storage-settings-tab";
import { Skeleton } from "@/components/ui/skeleton";
import { EncryptionKeyResolutionDialog, type KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import { keyOverrideBody, useEncryptionKeyRecovery } from "@/hooks/use-encryption-key-recovery";
import type { StorageHistoryTabRef } from "@/components/dashboard/storage/storage-history-tab";
import type { StorageSettingsTabRef } from "@/components/dashboard/storage/storage-settings-tab";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ component: "StorageClient" });

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
    /** Whether this user may create vault profiles, which key recovery does. */
    canManageVault?: boolean;
}

export function StorageClient({ canDownload, canRestore, canDelete, canManageVault = false }: StorageClientProps) {
    const [destinations, setDestinations] = useState<AdapterConfig[]>([]);
    const [selectedDestination, setSelectedDestination] = useState<string>("");
    const [open, setOpen] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();

    // Filter State
    const [showSystemConfigs, setShowSystemConfigs] = useState(false);

    const [sorting, setSorting] = useState<SortingState>([{ id: "lastModified", desc: true }]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const pendingJobFilter = useRef<string | null>(searchParams.get("job"));

    const [files, setFiles] = useState<FileInfo[]>([]);
    const [loading, setLoading] = useState(false);

    // Delete Confirmation State
    const [fileToDelete, setFileToDelete] = useState<FileInfo | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Download Link Modal State
    const [downloadLinkFile, setDownloadLinkFile] = useState<FileInfo | null>(null);
    /** Set when the link is for one database out of a seekable archive. */
    const [downloadLinkDatabase, setDownloadLinkDatabase] = useState<string | undefined>(undefined);

    // Database picker for backups holding several databases
    const [databaseDownloadFile, setDatabaseDownloadFile] = useState<FileInfo | null>(null);

    // Integrity Modal State
    const [verifyModalFile, setVerifyModalFile] = useState<FileInfo | null>(null);


    // Opens whenever a download reports that no available key opens the backup.
    const keyRecovery = useEncryptionKeyRecovery();
    /** Which backup the open dialog is about, so a typed key can be checked against it. */
    const [pendingKeyFile, setPendingKeyFile] = useState<FileInfo | null>(null);

    const fetchAdapters = useCallback(async () => {
        try {
            // Only destinations hold backups. A directory source would otherwise be offered here
            // and list its own contents as backup rows, delete button included.
            const storageRes = await fetch("/api/adapters?type=storage&role=DESTINATION");
            if (storageRes.ok) {
                const storageData = await storageRes.json();
                setDestinations(storageData);
                // Pre-select destination from URL param (e.g., when returning from restore page)
                const destParam = searchParams.get("destination");
                if (destParam) {
                    const match = storageData.find((d: AdapterConfig) => d.id === destParam);
                    if (match) setSelectedDestination(match.id);
                }
            }
        } catch (e) {
            log.error("Failed to load storage destinations", {}, wrapError(e));
        }
    }, [searchParams]);

    useEffect(() => {
        fetchAdapters();
    }, [fetchAdapters]);

    useEffect(() => {
        if (selectedDestination) {
            fetchFiles(selectedDestination, showSystemConfigs);
        } else {
            setFiles([]);
        }
    }, [selectedDestination, showSystemConfigs]);

    const fetchFiles = async (destId: string, showSystem: boolean, bypassCache = false) => {
        setLoading(true);
        try {
            const typeFilter = showSystem ? "SYSTEM" : "BACKUP";
            const qs = bypassCache ? `typeFilter=${typeFilter}&refresh=true` : `typeFilter=${typeFilter}`;
            const res = await fetch(`/api/storage/${destId}/files?${qs}`);
            if (res.ok) {
                const fetchedFiles: FileInfo[] = await res.json();
                setFiles(fetchedFiles);
                if (pendingJobFilter.current) {
                    const job = pendingJobFilter.current;
                    const exists = fetchedFiles.some(f => f.jobName === job);
                    if (exists) {
                        setColumnFilters([{ id: "jobName", value: [job] }]);
                    }
                    pendingJobFilter.current = null;
                }
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
        if (!decrypt) {
            // Non-decrypted download stays as direct browser navigation
            window.open(`/api/storage/${selectedDestination}/download?file=${encodeURIComponent(file.path)}`, '_blank');
            return;
        }
        // Decrypted download via fetch so we can intercept ENCRYPTION_KEY_REQUIRED errors
        void performDecryptedDownload(file, null);
    }, [canDownload, selectedDestination]); // eslint-disable-line react-hooks/exhaustive-deps

    const performDecryptedDownload = useCallback(async (file: FileInfo, keyResolution: KeyResolutionResult | null) => {
        if (!canDownload) return;
        const baseUrl = `/api/storage/${selectedDestination}/download`;

        try {
            // Fetch and decrypt server-side first; this call returns JSON, never the backup.
            // That is what lets the key dialog still work while the transfer itself stays a
            // plain browser download - a decrypted backup can be many gigabytes, and pulling
            // it through the page would mean holding all of it in this tab.
            const response = await fetch(baseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: file.path, prepare: true, ...keyOverrideBody(keyResolution) }),
            });

            if (await keyRecovery.intercept(response, (result) => performDecryptedDownload(file, result))) {
                setPendingKeyFile(file);
                return;
            }

            if (response.ok) {
                const payload = await response.json().catch(() => ({}));
                if (!payload?.data?.token) throw new Error(payload.error ?? "Download failed");

                const anchor = document.createElement("a");
                anchor.href = `${baseUrl}?token=${encodeURIComponent(payload.data.token)}`;
                anchor.click();
            } else {
                const data: { error?: string } = await response.json().catch(() => ({}));
                toast.error(data.error ?? "Download failed");
            }
        } catch {
            toast.error("Download failed");
        }
    }, [canDownload, selectedDestination]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRestoreClick = useCallback((file: FileInfo, mode?: RestoreMode) => {
        if (!canRestore) {
            toast.error("Permission denied");
            return;
        }
        const encoded = encodeUrlPayload(file);
        // The mode is only passed for backups holding both databases and directories -
        // everything else has exactly one thing to restore and needs no choice.
        const modeParam = mode && mode !== "all" ? `&mode=${mode}` : "";
        router.push(`/dashboard/storage/restore?destinationId=${encodeURIComponent(selectedDestination)}&file=${encodeURIComponent(encoded)}${modeParam}`);
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
        setDownloadLinkDatabase(undefined);
        setDownloadLinkFile(file);
    }, [canDownload]);

    const handleDownloadDatabase = useCallback((file: FileInfo) => {
        if (!canDownload) {
            toast.error("Permission denied");
            return;
        }
        setDatabaseDownloadFile(file);
    }, [canDownload]);

    const handleVerify = useCallback((file: FileInfo) => {
        setVerifyModalFile(file);
    }, []);

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

    /**
     * Downloads a complete snapshot rather than the raw archive.
     *
     * An incremental archive only stores what changed, so downloading the file itself
     * would hand the user a delta. This assembles the full contents from the chain.
     */
    const handleDownloadSnapshot = useCallback(async (file: FileInfo, keyResolution?: KeyResolutionResult) => {
        if (!canDownload) {
            toast.error("You do not have permission to download backups");
            return;
        }

        // A whole snapshot is exactly the case where buffering the response in the tab falls
        // over - it can be many gigabytes - so the browser fetches the prepared result itself.
        await startPreparedArchiveDownload({
            destinationId: selectedDestination,
            body: { file: file.path, ...keyOverrideBody(keyResolution) },
            // Unpacking the archive needs its key, so this can ask for one just like a
            // decrypted download can.
            intercept: async (res) => {
                const tookOver = await keyRecovery.intercept(res, (result) => handleDownloadSnapshot(file, result));
                if (tookOver) setPendingKeyFile(file);
                return tookOver;
            },
            preparingLabel: `Preparing ${file.name}...`,
        });
    }, [canDownload, selectedDestination]); // eslint-disable-line react-hooks/exhaustive-deps

    const bulkActions = useMemo<BulkAction<FileInfo>[]>(() => {
        if (!canDelete || !selectedDestination) return [];

        const runAction = (action: "delete" | "lock" | "unlock", rows: FileInfo[]) =>
            requestBulk(`/api/storage/${selectedDestination}/files/bulk`, {
                action,
                paths: rows.map((file) => file.path),
            });

        return [
            {
                id: "lock",
                labels: { verb: "lock", verbPast: "locked", noun: "backup" },
                icon: Lock,
                isAvailable: (rows) => rows.some((file) => !file.locked),
                itemName: (file) => file.name,
                ineligible: (file) => (file.locked ? "Already locked" : null),
                run: (rows) => runAction("lock", rows),
            },
            {
                id: "unlock",
                labels: { verb: "unlock", verbPast: "unlocked", noun: "backup" },
                icon: LockOpen,
                isAvailable: (rows) => rows.some((file) => file.locked),
                itemName: (file) => file.name,
                ineligible: (file) => (file.locked ? null : "Not locked"),
                run: (rows) => runAction("unlock", rows),
            },
            {
                id: "delete",
                labels: { verb: "delete", verbPast: "deleted", noun: "backup" },
                icon: Trash2,
                variant: "destructive",
                itemName: (file) => file.name,
                // A locked backup was deliberately protected. The server refuses it too,
                // this only makes the refusal visible before the request goes out.
                ineligible: (file) => (file.locked ? "Locked, unlock it first" : null),
                confirm: {
                    title: (rows) => `Delete ${rows.length} backup${rows.length === 1 ? "" : "s"}?`,
                    description: () =>
                        "This permanently removes the archives and their metadata from this destination. It cannot be undone.",
                    confirmLabel: "Delete",
                },
                run: (rows) => runAction("delete", rows),
            },
        ];
    }, [canDelete, selectedDestination]);

    const columns = useMemo(() => getColumns({
        onRestore: handleRestoreClick,
        onDownloadSnapshot: handleDownloadSnapshot,
        onDownloadDatabase: handleDownloadDatabase,
        onDownload: handleDownload,
        onDelete: handleDeleteClick,
        onToggleLock: handleToggleLock,
        onGenerateLink: handleGenerateLink,
        onVerify: handleVerify,
        canDownload,
        canRestore,
        canDelete
    }), [handleRestoreClick, handleDownloadSnapshot, handleDownloadDatabase, handleDownload, handleDeleteClick, handleToggleLock, handleGenerateLink, handleVerify, canDownload, canRestore, canDelete]);

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

    const [activeTab, setActiveTab] = useState("explorer");

    const historyRef = useRef<StorageHistoryTabRef>(null);
    const settingsRef = useRef<StorageSettingsTabRef>(null);

    const handleRefresh = useCallback(() => {
        switch (activeTab) {
            case "explorer":
                fetchFiles(selectedDestination, showSystemConfigs, true);
                break;
            case "history":
                historyRef.current?.refresh();
                break;
            case "settings":
                settingsRef.current?.refresh();
                break;
        }
    }, [activeTab, selectedDestination, showSystemConfigs]);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Storage Explorer</h2>
                <p className="text-muted-foreground">Browse, download, and restore backup files from your destinations.</p>
            </div>

            <div className="flex items-center space-x-4 justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-75">
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={open}
                                    className="w-full justify-between"
                                >
                                    {selectedDestination ? (
                                        <span className="flex items-center gap-2 min-w-0">
                                            <AdapterIcon adapterId={destinations.find((dest) => dest.id === selectedDestination)?.adapterId ?? ""} className="h-4 w-4 shrink-0" />
                                            <span className="truncate">{destinations.find((dest) => dest.id === selectedDestination)?.name}</span>
                                        </span>
                                    ) : "Select Destination..."}
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
                                                    className={cn(selectedDestination === destination.id && "bg-accent")}
                                                >
                                                    <AdapterIcon adapterId={destination.adapterId} className="h-4 w-4" />
                                                    {destination.name}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                    {selectedDestination && (
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={handleRefresh}
                            disabled={loading}
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        </Button>
                    )}
                </div>

                {selectedDestination && activeTab === "explorer" && (
                    <div className="flex items-center space-x-2">
                        <Switch
                            id="show-system-configs"
                            checked={showSystemConfigs}
                            onCheckedChange={setShowSystemConfigs}
                        />
                        <Label htmlFor="show-system-configs">Show System Configs</Label>
                    </div>
                )}
            </div>

            {selectedDestination && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="explorer">Explorer</TabsTrigger>
                        <TabsTrigger value="history">History</TabsTrigger>
                        <TabsTrigger value="settings">Settings</TabsTrigger>
                    </TabsList>

                    <TabsContent value="explorer" className="mt-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Backups</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {/* Only the very first load swaps the table for a skeleton. A
                                    refresh keeps the table mounted, otherwise the unmount
                                    would discard any row selection mid-flow. */}
                                {loading && files.length === 0 ? (
                                    <div className="space-y-4">
                                        {/* Toolbar skeleton */}
                                        <div className="flex items-center gap-2">
                                            <Skeleton className="h-9 w-64" />
                                            <Skeleton className="h-9 w-28" />
                                            <Skeleton className="h-9 w-28" />
                                        </div>
                                        {/* Table header skeleton */}
                                        <div className="border rounded-md">
                                            <div className="flex items-center gap-4 px-4 py-3 border-b bg-muted/50">
                                                <Skeleton className="h-4 w-4" />
                                                <Skeleton className="h-4 w-40" />
                                                <Skeleton className="h-4 w-16" />
                                                <Skeleton className="h-4 w-20" />
                                                <Skeleton className="h-4 w-16" />
                                                <Skeleton className="h-4 w-16" />
                                                <Skeleton className="h-4 w-16 ml-auto" />
                                                <Skeleton className="h-4 w-24" />
                                            </div>
                                            {/* Table rows skeleton */}
                                            {[...Array(6)].map((_, i) => (
                                                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-b-0">
                                                    <Skeleton className="h-4 w-4" />
                                                    <Skeleton className="h-4 w-48" />
                                                    <Skeleton className="h-5 w-16 rounded-full" />
                                                    <Skeleton className="h-4 w-24" />
                                                    <Skeleton className="h-4 w-12" />
                                                    <Skeleton className="h-4 w-12" />
                                                    <Skeleton className="h-4 w-16 ml-auto" />
                                                    <Skeleton className="h-4 w-28" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <DataTable
                                        // A file is identified by its path, which is only
                                        // unique within one destination. Remounting on a
                                        // switch keeps a selection from carrying over into
                                        // a bucket where those paths mean something else.
                                        key={selectedDestination}
                                        columns={columns}
                                        data={files}
                                        filterableColumns={filterableColumns}
                                        sorting={sorting}
                                        onSortingChange={setSorting}
                                        columnFilters={columnFilters}
                                        onColumnFiltersChange={setColumnFilters}
                                        onRefresh={() => selectedDestination && fetchFiles(selectedDestination, showSystemConfigs)}
                                        isLoading={loading}
                                        enableRowSelection={canDelete}
                                        getRowId={(file) => file.path}
                                        bulkActions={bulkActions}
                                        onBulkActionComplete={() => { if (selectedDestination) fetchFiles(selectedDestination, showSystemConfigs); }}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="history" className="mt-4">
                        <StorageHistoryTab
                            ref={historyRef}
                            configId={selectedDestination}
                            adapterName={destinations.find(d => d.id === selectedDestination)?.name || ""}
                        />
                    </TabsContent>

                    <TabsContent value="settings" className="mt-4">
                        <StorageSettingsTab
                            ref={settingsRef}
                            configId={selectedDestination}
                            adapterName={destinations.find(d => d.id === selectedDestination)?.name || ""}
                        />
                    </TabsContent>
                </Tabs>
            )}

            {/* Restore now uses /dashboard/storage/restore page */}

            {/* Empty State (no destination selected) */}
            {!selectedDestination && (
                <Card>
                    <CardContent className="py-16">
                        <div className="text-center text-muted-foreground">
                            <HardDrive className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p className="text-lg font-medium">Select a storage destination</p>
                            <p className="text-sm mt-1">Choose a destination above to browse your backup files.</p>
                        </div>
                    </CardContent>
                </Card>
            )}

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
                        hasFileIndex: downloadLinkFile.hasFileIndex,
                        combined: downloadLinkFile.combined,
                        dbInfo: downloadLinkFile.dbInfo,
                    }}
                    database={downloadLinkDatabase}
                />
            )}

            {/* Database picker */}
            <DatabaseDownloadDialog
                open={!!databaseDownloadFile}
                onOpenChange={(o) => { if (!o) setDatabaseDownloadFile(null); }}
                destinationId={selectedDestination}
                file={databaseDownloadFile}
                keyOverride={keyRecovery.override}
                interceptKeyRequest={async (res, retry) => {
                    const tookOver = await keyRecovery.intercept(res, retry);
                    if (tookOver) setPendingKeyFile(databaseDownloadFile);
                    return tookOver;
                }}
                onGenerateLink={canDownload && databaseDownloadFile ? (database) => {
                    setDownloadLinkDatabase(database);
                    setDownloadLinkFile(databaseDownloadFile);
                } : undefined}
            />

            {/* Integrity Modal */}
            {verifyModalFile && (
                <IntegrityModal
                    open={!!verifyModalFile}
                    onOpenChange={(o) => { if (!o) setVerifyModalFile(null); }}
                    file={verifyModalFile}
                    storageConfigId={selectedDestination}
                    onVerifyComplete={() => fetchFiles(selectedDestination, showSystemConfigs)}
                />
            )}

            {/* Encryption Key Resolution Dialog (decrypted download fallback) */}
            <EncryptionKeyResolutionDialog
                open={keyRecovery.open}
                onOpenChange={(o) => {
                    keyRecovery.onOpenChange(o);
                    if (!o) setPendingKeyFile(null);
                }}
                profileIdHint={keyRecovery.profileIdHint}
                backup={pendingKeyFile ? { storageConfigId: selectedDestination, file: pendingKeyFile.path } : undefined}
                canManageVault={canManageVault}
                onConfirm={keyRecovery.onConfirm}
                loading={keyRecovery.loading}
                error={keyRecovery.error}
            />
        </div>
    );
}
