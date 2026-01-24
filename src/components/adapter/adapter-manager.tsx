
"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Edit, Trash } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { AdapterManagerProps, AdapterConfig } from "./types";
import { AdapterForm } from "./adapter-form";

export function AdapterManager({ type, title, description, canManage = true }: AdapterManagerProps) {
    const [configs, setConfigs] = useState<AdapterConfig[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [availableAdapters, setAvailableAdapters] = useState<AdapterDefinition[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

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
                case 'mongodb':
                    return <span className="text-muted-foreground">{config.user}@{config.host}:{config.port}</span>;
                case 'local-filesystem':
                    return <span className="font-mono text-xs">{config.basePath}</span>;
                case 'discord':
                    return <span className="text-muted-foreground">Webhook</span>;
                case 'email':
                    return <span className="text-muted-foreground">{config.from} → {config.to}</span>;
                default:
                    return <span className="text-muted-foreground">-</span>;
            }
        } catch {
            return <span className="text-destructive">Invalid Config</span>;
        }
    };

    const columns: ColumnDef<AdapterConfig>[] = [
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
                if (!canManage) return null;
                return (
                    <div className="flex justify-end gap-1">
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
                    </div>
                );
            }
        }
    ];

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
                                <Button onClick={() => { setEditingId(null); setIsDialogOpen(true); }}>
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
                        />
                    </CardContent>
                </Card>
            )}

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingId ? "Edit Configuration" : (type === 'notification' ? "Add New Notification" : (type === 'database' ? "Add New Source" : (type === 'storage' ? "Add New Destination" : "Add New Configuration")))}</DialogTitle>
                    </DialogHeader>
                    {isDialogOpen && (
                        <AdapterForm
                            type={type}
                            adapters={availableAdapters}
                            onSuccess={() => { setIsDialogOpen(false); fetchConfigs(); }}
                            initialData={editingId ? configs.find(c => c.id === editingId) : undefined}
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
        </div>
    );
}
