
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { ADAPTER_DEFINITIONS, AdapterDefinition } from "@/lib/adapters/definitions";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash, BarChart3, SearchCode } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { AdapterManagerProps, AdapterConfig } from "./types";
import { AdapterForm } from "./adapter-form";
import { AdapterPicker } from "./adapter-picker";
import { HealthStatusBadge } from "@/components/ui/health-status-badge";
import { StorageHistoryModal } from "@/components/dashboard/widgets/storage-history-modal";

export function AdapterManager({ type, title, description, canManage = true }: AdapterManagerProps) {
    const [configs, setConfigs] = useState<AdapterConfig[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [selectedAdapterForNew, setSelectedAdapterForNew] = useState<string | null>(null);
    const [availableAdapters, setAvailableAdapters] = useState<AdapterDefinition[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [historyAdapter, setHistoryAdapter] = useState<{ id: string; name: string } | null>(null);
    const router = useRouter();

    const fetchConfigs = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/adapters?type=${type}`);
            if (res.ok) {
                const data = await res.json();
                setConfigs(data);
            } else {
                 const data = await res.json();
                 toast.error(data.error || "Failed to load configurations");
            }
        } catch (_error) {
            toast.error("Failed to load configurations");
        } finally {
            setIsLoading(false);
        }
    }, [type]);

    useEffect(() => {
        // Filter definitions by type
        setAvailableAdapters(ADAPTER_DEFINITIONS.filter(d => d.type === type));
        fetchConfigs();
    }, [type, fetchConfigs]);

    const handleDelete = (id: string) => {
        setDeletingId(id);
    };

    const confirmDelete = async () => {
        if (!deletingId) return;
        const id = deletingId;

        try {
            const res = await fetch(`/api/adapters/${id}`, { method: 'DELETE' });
            const data = await res.json();

            if (res.ok && data.success) {
                toast.success("Configuration deleted");
                setConfigs(configs.filter(c => c.id !== id));
            } else {
                toast.error(data.error || "Failed to delete");
            }
        } catch (_error) {
             toast.error("Error deleting configuration");
        } finally {
            setDeletingId(null);
        }
    };

    const getSummary = (adapterId: string, configJson: string) => {
        try {
            const config = JSON.parse(configJson);
            switch (adapterId) {
                case 'mysql':
                case 'postgres':
                case 'mariadb':
                case 'mssql':
                case 'mongodb':
                    return <span className="text-muted-foreground">{config.user}@{config.host}:{config.port}</span>;
                case 'redis':
                    return <span className="text-muted-foreground">{config.host}:{config.port} (DB {config.database ?? 0})</span>;
                case 'local-filesystem':
                    return <span className="text-muted-foreground">{config.basePath}</span>;
                case 'smb':
                    return <span className="text-muted-foreground">{config.pathPrefix || config.address}</span>;
                case 'sftp':
                    return <span className="text-muted-foreground">{config.pathPrefix || `${config.host}:${config.port}`}</span>;
                case 'webdav':
                    return <span className="text-muted-foreground">{config.pathPrefix || config.url}</span>;
                case 'ftp':
                    return <span className="text-muted-foreground">{config.pathPrefix || `${config.host}:${config.port}`}</span>;
                case 'rsync':
                    return <span className="text-muted-foreground">{config.pathPrefix || `${config.host}:${config.port}`}</span>;
                case 'google-drive':
                    return <span className="text-muted-foreground">{config.folderId ? `Folder: ${config.folderId.substring(0, 12)}...` : 'Root'}</span>;
                case 'dropbox':
                    return <span className="text-muted-foreground">{config.folderPath || '/ (Root)'}</span>;
                case 'onedrive':
                    return <span className="text-muted-foreground">{config.folderPath || '/ (Root)'}</span>;
                case 'discord':
                case 'slack':
                case 'teams':
                    return <span className="text-muted-foreground">Webhook</span>;
                case 'generic-webhook':
                    return <span className="text-muted-foreground">{config.method || 'POST'} → {config.webhookUrl}</span>;
                case 'gotify':
                    return <span className="text-muted-foreground">{config.serverUrl}</span>;
                case 'ntfy':
                    return <span className="text-muted-foreground">{config.serverUrl}/{config.topic}</span>;
                case 'telegram':
                    return <span className="text-muted-foreground">Chat {config.chatId}</span>;
                case 'twilio-sms':
                    return <span className="text-muted-foreground">{config.from} → {config.to}</span>;
                case 'email': {
                    const to = Array.isArray(config.to)
                        ? config.to.length > 2
                            ? `${config.to.slice(0, 2).join(", ")} +${config.to.length - 2}`
                            : config.to.join(", ")
                        : config.to;
                    return <span className="text-muted-foreground">{config.from} → {to}</span>;
                }
                default:
                    // S3 variants (s3-aws, s3-generic, s3-r2, s3-hetzner, s3-minio)
                    if (adapterId.startsWith('s3')) {
                        return <span className="text-muted-foreground">{config.bucket}</span>;
                    }
                    return <span className="text-muted-foreground">-</span>;
            }
        } catch {
            return <span className="text-destructive">Invalid Config</span>;
        }
    };

    const columns: ColumnDef<AdapterConfig>[] = [
        // Health status column – not relevant for notification adapters
        ...(type !== 'notification' ? [{
            id: "status",
            header: "Status",
            cell: ({ row }: { row: any }) => {
                // Determine health status from config props
                const lastCheck = row.original.lastHealthCheck;
                // If lastHeathCheck is null, default to PENDING
                const status = lastCheck ? (row.original.lastStatus || "ONLINE") : "PENDING";

                return (
                    <HealthStatusBadge
                        status={status}
                        adapterId={row.original.id}
                        lastChecked={lastCheck}
                    />
                );
            }
        }] as ColumnDef<AdapterConfig>[] : []),
        {
            accessorKey: "name",
            header: "Name",
            cell: ({ row }) => (
                <div className="font-medium">{row.getValue("name")}</div>
            )
        },
        {
            accessorKey: "adapterId",
            header: "Type",
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
            cell: ({ row }) => {
                const def = ADAPTER_DEFINITIONS.find(d => d.id === row.getValue("adapterId"));
                return (
                    <div className="flex items-center gap-2">
                         {/* Optional Icon based on type/id could go here */}
                         <Badge variant="outline">{def?.name || row.getValue("adapterId")}</Badge>
                    </div>
                );
            }
        },
        // Database Version Column
        ...(type === 'database' ? [{
            id: "version",
            header: "Version",
            cell: ({ row }: { row: any }) => {
                try {
                    if (!row.original.metadata) return <span className="text-muted-foreground">-</span>;
                    const meta = JSON.parse(row.original.metadata);
                    if (!meta.engineVersion) return <span className="text-muted-foreground">-</span>;
                    return <Badge variant="secondary" className="font-mono text-xs">{meta.engineVersion}</Badge>;
                } catch { return <span className="text-muted-foreground">-</span>; }
            }
        }] : []),
        {
            id: "summary",
            header: "Details",
            cell: ({ row }) => getSummary(row.original.adapterId, row.original.config)
        },
        {
            id: "actions",
            header: () => <div className="text-right">Actions</div>,
            cell: ({ row }) => {
                return (
                    <div className="flex justify-end gap-1">
                        {type === "database" && (
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Inspect Databases"
                                onClick={() => router.push(`/dashboard/explorer?sourceId=${row.original.id}`)}
                            >
                                <SearchCode className="h-4 w-4" />
                            </Button>
                        )}
                        {type === "storage" && (
                            <Button
                                variant="ghost"
                                size="icon"
                                title="Storage History"
                                onClick={() => setHistoryAdapter({ id: row.original.id, name: row.original.name })}
                            >
                                <BarChart3 className="h-4 w-4" />
                            </Button>
                        )}
                        {canManage && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => { setEditingId(row.original.id); setIsDialogOpen(true); }}
                                >
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDelete(row.original.id)}
                                >
                                    <Trash className="h-4 w-4 text-destructive" />
                                </Button>
                            </>
                        )}
                    </div>
                );
            }
        }
    ];

    // Only show filter options for adapter types that have at least one config entry
    const typeFilterColumns = useMemo(() => {
        const usedAdapterIds = new Set(configs.map(c => c.adapterId));
        const options = availableAdapters
            .filter(a => usedAdapterIds.has(a.id))
            .map(a => ({ label: a.name, value: a.id }));

        if (options.length <= 1) return [];
        return [{ id: "adapterId", title: "Type", options }];
    }, [configs, availableAdapters]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
                    <p className="text-muted-foreground">{description}</p>
                </div>
            </div>

            {isLoading ? (
                <Card>
                    <CardHeader>
                         <div className="flex items-center justify-between">
                            <div className="space-y-2">
                                <Skeleton className="h-5 w-32" />
                                <Skeleton className="h-4 w-48" />
                            </div>
                            <Skeleton className="h-10 w-28" />
                         </div>
                    </CardHeader>
                    <CardContent>
                         <div className="space-y-4">
                             <Skeleton className="h-10 w-full" />
                             <Skeleton className="h-10 w-full" />
                             <Skeleton className="h-10 w-full" />
                         </div>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle>{title}</CardTitle>
                                <CardDescription>Manage your {type} configurations.</CardDescription>
                            </div>
                            {canManage && (
                                <Button onClick={() => { setEditingId(null); setSelectedAdapterForNew(null); setIsPickerOpen(true); }}>
                                    <Plus className="mr-2 h-4 w-4" /> Add New
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <DataTable
                            columns={columns}
                            data={configs}
                            searchKey="name"
                            onRefresh={fetchConfigs}
                            filterableColumns={typeFilterColumns}
                        />
                    </CardContent>
                </Card>
            )}

            {/* Step 1: Adapter Picker */}
            <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{type === 'notification' ? "Select Notification Type" : (type === 'database' ? "Select Database Type" : (type === 'storage' ? "Select Destination Type" : "Select Type"))}</DialogTitle>
                    </DialogHeader>
                    <AdapterPicker
                        adapters={availableAdapters}
                        onSelect={(adapter) => {
                            setSelectedAdapterForNew(adapter.id);
                            setIsPickerOpen(false);
                            setIsDialogOpen(true);
                        }}
                    />
                </DialogContent>
            </Dialog>

            {/* Step 2: Adapter Form */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingId ? "Edit Configuration" : (type === 'notification' ? "Add New Notification" : (type === 'database' ? "Add New Source" : (type === 'storage' ? "Add New Destination" : "Add New Configuration")))}</DialogTitle>
                    </DialogHeader>
                    {isDialogOpen && (
                        <AdapterForm
                            type={type}
                            adapters={selectedAdapterForNew ? availableAdapters.filter(a => a.id === selectedAdapterForNew) : availableAdapters}
                            onSuccess={() => { setIsDialogOpen(false); setSelectedAdapterForNew(null); fetchConfigs(); }}
                            initialData={editingId ? configs.find(c => c.id === editingId) : undefined}
                            onBack={!editingId ? () => { setIsDialogOpen(false); setSelectedAdapterForNew(null); setIsPickerOpen(true); } : undefined}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete this configuration.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {historyAdapter && (
                <StorageHistoryModal
                    open={!!historyAdapter}
                    onOpenChange={(open) => { if (!open) setHistoryAdapter(null); }}
                    configId={historyAdapter.id}
                    adapterName={historyAdapter.name}
                />
            )}
        </div>
    );
}
