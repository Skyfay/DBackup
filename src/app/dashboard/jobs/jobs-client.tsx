"use client";

import { useEffect, useState, useCallback } from "react";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Edit, Play, Trash2, Clock, Lock, Webhook, Copy, FolderOpen, FolderInput } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { JobForm, JobData, JobSourceData, AdapterOption, EncryptionOption } from "@/components/dashboard/jobs/job-form";
import { ApiTriggerDialog } from "@/components/dashboard/jobs/api-trigger-dialog";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { CloneDialog } from "@/components/ui/clone-dialog";
import { DateDisplay } from "@/components/utils/date-display";

// Extended destination with config relation from API
interface JobDestinationWithConfig {
    configId: string;
    priority: number;
    retention: string;
    retentionPolicyId?: string | null;
    config: { id: string; name: string; adapterId: string };
}

// Extended Job type for display (includes related entity names)
interface Job extends Omit<JobData, 'destinations'> {
    source: { name: string, type: string, adapterId: string } | null;
    sources?: (JobSourceData & { config: { id: string; name: string; adapterId: string } })[];
    destinations: JobDestinationWithConfig[];
    createdAt: string;
    encryptionProfile?: { name: string };
    namingTemplateId?: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
}

interface JobsClientProps {
    canManage: boolean;
    canExecute: boolean;
    sources: AdapterOption[];
    destinations: AdapterOption[];
    notificationChannels: AdapterOption[];
    encryptionProfiles: EncryptionOption[];
}

export function JobsClient({ canManage, canExecute, sources, destinations, notificationChannels, encryptionProfiles }: JobsClientProps) {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const directorySourceOptions = useMemo(() => destinations.filter((d) => d.storageRole === STORAGE_ROLES.SOURCE), [destinations]);

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingJob, setEditingJob] = useState<Job | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [cloningJobId, setCloningJobId] = useState<string | null>(null);
    const [cloneTarget, setCloneTarget] = useState<{ id: string; name: string } | null>(null);
    const [apiTriggerJob, setApiTriggerJob] = useState<{ id: string; name: string } | null>(null);
    const router = useRouter();
    const { autoRedirectOnJobStart } = useUserPreferences();

    const fetchJobs = async () => {
        try {
            const res = await fetch("/api/jobs");
            if (res.ok) {
                 setJobs(await res.json());
            } else {
                 const data = await res.json();
                 toast.error(data.error || "Failed to fetch jobs");
            }
        } catch { toast.error("Failed to fetch jobs"); }
    };

    useEffect(() => {
        const init = async () => {
             setIsLoading(true);
             await fetchJobs();
             setIsLoading(false);
        };
        init();
    }, []);

    const handleDelete = (id: string) => {
        setDeletingId(id);
    };

    const confirmDelete = async () => {
        if (!deletingId) return;
        try {
            const res = await fetch(`/api/jobs/${deletingId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Job deleted");
                fetchJobs();
            } else {
                toast.error("Failed to delete job");
            }
        } catch { toast.error("Error deleting job"); }
        setDeletingId(null);
    };

    const cloneJob = useCallback(async (id: string, name: string) => {
        setCloningJobId(id);
        try {
            const res = await fetch(`/api/jobs/${id}/clone`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("Job cloned successfully");
                const refreshed = await fetch("/api/jobs");
                if (refreshed.ok) setJobs(await refreshed.json());
            } else {
                toast.error(data.error || "Failed to clone job");
            }
        } catch { toast.error("Error cloning job"); }
        finally {
            setCloningJobId(null);
            setCloneTarget(null);
        }
    }, []);

    const runJob = useCallback(async (id: string) => {
        toast.info("Starting backup job...");
        try {
            const res = await fetch(`/api/jobs/${id}/run`, { method: "POST" });
            const data = await res.json();
            if (data.success) {
                toast.success("Job started successfully");
                if (data.executionId && autoRedirectOnJobStart) {
                    router.push(`/dashboard/history?executionId=${data.executionId}`);
                }
            } else {
                toast.error(`Job failed: ${data.error}`);
            }
        } catch { toast.error("Execution request failed"); }
    }, [router, autoRedirectOnJobStart]);

    const columns = useMemo<ColumnDef<Job>[]>(() => [
        {
            accessorKey: "name",
            header: "Job Name",
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-medium">{row.original.name}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {row.original.schedule}
                    </span>
                </div>
            )
        },
        {
            accessorKey: "enabled",
            header: "Status",
            cell: ({ row }) => (
                <Badge variant={row.original.enabled ? "default" : "secondary"}>
                    {row.original.enabled ? "Enabled" : "Paused"}
                </Badge>
            )
        },
        {
            accessorKey: "source.name",
            header: "Source",
            cell: ({ row }) => {
                const source = row.original.source;
                const dirSources = row.original.sources || [];
                if (!source && dirSources.length === 0) {
                    return <span className="text-muted-foreground text-sm">-</span>;
                }
                return (
                    <div className="flex flex-col gap-0.5">
                        {source && (
                            <div className="flex items-center gap-1.5 text-sm">
                                <AdapterIcon adapterId={source.adapterId} className="h-3.5 w-3.5" />
                                {source.name}
                            </div>
                        )}
                        {dirSources.map((s, i) => (
                            <div key={`${s.configId}-${s.path}-${i}`} className="flex items-center gap-1.5 text-sm">
                                <FolderInput className="h-3.5 w-3.5" />
                                {s.config?.name || s.configId}
                                <span className="text-muted-foreground truncate max-w-40">{s.path}</span>
                            </div>
                        ))}
                    </div>
                );
            }
        },
        {
            id: "destinations",
            header: "Destinations",
            cell: ({ row }) => {
                const dests = row.original.destinations || [];
                if (dests.length === 0) return <span className="text-muted-foreground text-sm">-</span>;
                return (
                    <div className="flex flex-col gap-0.5">
                        {dests.map((d, i) => (
                            <div key={d.configId || i} className="flex items-center gap-1.5 text-sm">
                                <AdapterIcon adapterId={d.config?.adapterId ?? ""} className="h-3.5 w-3.5" />
                                {d.config?.name || d.configId}
                            </div>
                        ))}
                    </div>
                );
            }
        },
        {
            id: "compression",
            header: "Compression",
            cell: ({ row }) => {
                const comp = row.original.compression;
                if (!comp || comp === "NONE") return <span className="text-muted-foreground text-sm">-</span>;
                return (
                     <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-blue-200 text-blue-700 dark:text-blue-400 dark:border-blue-900">
                        {comp}
                    </Badge>
                );
            }
        },
        {
            id: "encryption",
            header: "Encryption",
            cell: ({ row }) => {
                const profile = row.original.encryptionProfile;
                return profile ? (
                     <Badge variant="outline" className="border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-500">
                        <Lock className="mr-1 h-3 w-3" />
                        {profile.name}
                    </Badge>
                ) : (
                    <span className="text-muted-foreground text-sm">-</span>
                );
            }
        },
        {
            id: "lastRunAt",
            header: "Last Run",
            cell: ({ row }) => {
                const v = row.original.lastRunAt;
                return v ? <DateDisplay date={v} format="Pp" className="tabular-nums text-sm" /> : <span className="text-muted-foreground text-sm">-</span>;
            }
        },
        {
            id: "nextRunAt",
            header: "Next Run",
            cell: ({ row }) => {
                const v = row.original.nextRunAt;
                return v ? <DateDisplay date={v} format="Pp" className="tabular-nums text-sm" /> : <span className="text-muted-foreground text-sm">-</span>;
            }
        },
        {
            id: "actions",
            header: () => <div className="text-right">Actions</div>,
            cell: ({ row }) => {
                const dests = row.original.destinations || [];
                const backupsButton = dests.length === 0 ? null : dests.length === 1 ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        title={`Browse Backups: ${dests[0].config?.name}`}
                        onClick={() => router.push(`/dashboard/storage?destination=${dests[0].configId}&job=${encodeURIComponent(row.original.name)}`)}
                    >
                        <FolderOpen className="h-4 w-4" />
                    </Button>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" title="Browse Backups">
                                <FolderOpen className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {dests.map((d, i) => (
                                <DropdownMenuItem
                                    key={d.configId || i}
                                    onClick={() => router.push(`/dashboard/storage?destination=${d.configId}&job=${encodeURIComponent(row.original.name)}`)}
                                >
                                    <AdapterIcon adapterId={d.config?.adapterId ?? ""} className="h-4 w-4 mr-2" />
                                    {d.config?.name || d.configId}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                );

                return (
                    <div className="flex justify-end gap-1">
                        {canExecute && (
                            <Button variant="ghost" size="icon" onClick={() => runJob(row.original.id)} title="Run Now">
                                <Play className="h-4 w-4 text-green-500" />
                            </Button>
                        )}
                        {backupsButton}
                        {canExecute && (
                            <Button variant="ghost" size="icon" onClick={() => setApiTriggerJob({ id: row.original.id, name: row.original.name })} title="API Trigger">
                                <Webhook className="h-4 w-4" />
                            </Button>
                        )}
                        {canManage && (
                            <>
                                <Button variant="ghost" size="icon" onClick={() => setCloneTarget({ id: row.original.id, name: row.original.name })} disabled={cloningJobId === row.original.id} title="Clone Job">
                                    <Copy className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => { setEditingJob(row.original); setIsDialogOpen(true); }}>
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDelete(row.original.id)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </>
                        )}
                    </div>
                );
            }
        }
    ], [canManage, canExecute, runJob, cloningJobId, router]);

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Backup Jobs</h2>
                        <p className="text-muted-foreground">Manage and schedule automated backup tasks.</p>
                    </div>
                </div>
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div className="space-y-2">
                                <Skeleton className="h-5 w-32" />
                                <Skeleton className="h-4 w-48" />
                            </div>
                            {canManage && <Skeleton className="h-10 w-32" />}
                        </div>
                    </CardHeader>
                    <CardContent>
                         <div className="space-y-4">
                             <Skeleton className="h-12 w-full" />
                             <Skeleton className="h-12 w-full" />
                             <Skeleton className="h-12 w-full" />
                         </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Backup Jobs</h2>
                    <p className="text-muted-foreground">Manage and schedule automated backup tasks.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Jobs</CardTitle>
                            <CardDescription>Configure and monitor your backup schedules.</CardDescription>
                        </div>
                        {canManage && (
                            <Button onClick={() => { setEditingJob(null); setIsDialogOpen(true); }}>
                                <Plus className="mr-2 h-4 w-4" /> Create Job
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={jobs}
                        searchKey="name"
                        onRefresh={fetchJobs}
                    />
                </CardContent>
            </Card>


            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-4xl sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{editingJob ? "Edit Backup Job" : "Create New Backup Job"}</DialogTitle>
                        <DialogDescription>
                            {editingJob ? "Update the configuration for this backup job." : "Configure a new backup job with source, destinations, and schedule."}
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9rem)]">
                        <div className="pr-3">
                            {isDialogOpen && (
                                <JobForm
                                    sources={sources}
                                    destinations={destinations}
                                    directorySourceOptions={directorySourceOptions}
                                    notifications={notificationChannels}
                                    encryptionProfiles={encryptionProfiles}
                                    initialData={editingJob}
                                    onSuccess={() => { setIsDialogOpen(false); fetchJobs(); }}
                                />
                            )}
                        </div>
                    </ScrollArea>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the backup job.
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

            {apiTriggerJob && (
                <ApiTriggerDialog
                    jobId={apiTriggerJob.id}
                    jobName={apiTriggerJob.name}
                    open={!!apiTriggerJob}
                    onOpenChange={(open) => !open && setApiTriggerJob(null)}
                />
            )}

            <CloneDialog
                open={!!cloneTarget}
                onOpenChange={(open) => !open && setCloneTarget(null)}
                defaultName={cloneTarget?.name ?? ""}
                existingNames={jobs.map((j) => j.name)}
                isLoading={!!cloningJobId}
                onConfirm={(name) => cloneJob(cloneTarget!.id, name)}
            />
        </div>
    );
}
