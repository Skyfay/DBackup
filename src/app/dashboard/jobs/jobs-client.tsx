"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Edit, Play, Trash2, Clock, Lock } from "lucide-react";
import { toast } from "sonner";
import { JobForm, JobData, AdapterOption, EncryptionOption } from "@/components/dashboard/jobs/job-form";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { getEncryptionProfiles } from "@/app/actions/encryption";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

// Extended Job type for display (includes related entity names)
interface Job extends JobData {
    source: { name: string, type: string };
    destination: { name: string, type: string };
    createdAt: string;
    encryptionProfile?: { name: string };
}

interface JobsClientProps {
    canManage: boolean;
    canExecute: boolean;
}

export function JobsClient({ canManage, canExecute }: JobsClientProps) {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [sources, setSources] = useState<AdapterOption[]>([]);
    const [destinations, setDestinations] = useState<AdapterOption[]>([]);
    const [notificationChannels, setNotificationChannels] = useState<AdapterOption[]>([]);
    const [encryptionProfiles, setEncryptionProfiles] = useState<EncryptionOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingJob, setEditingJob] = useState<JobData | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const router = useRouter();

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

    const fetchAdapters = async () => {
        try {
            const [s, d, n] = await Promise.all([
                fetch("/api/adapters?type=database").then(r => r.json()),
                fetch("/api/adapters?type=storage").then(r => r.json()),
                fetch("/api/adapters?type=notification").then(r => r.json())
            ]);
            setSources(s);
            setDestinations(d);
            setNotificationChannels(n);

            const encRes = await getEncryptionProfiles();
            if (encRes.success && encRes.data) {
                setEncryptionProfiles(encRes.data.map((p: any) => ({ id: p.id, name: p.name })));
            }
        } catch { toast.error("Failed to fetch adapters"); }
    };

    useEffect(() => {
        // Wrap in IIFE or just call them, but ensure async pattern is clean
        const init = async () => {
             setIsLoading(true);
             await Promise.all([fetchJobs(), fetchAdapters()]);
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

    const runJob = async (id: string) => {
        toast.info("Starting backup job...");
        try {
            const res = await fetch(`/api/jobs/${id}/run`, { method: "POST" });
            const data = await res.json();
            if (data.success) {
                toast.success("Job started successfully");
                if (data.executionId) {
                    router.push(`/dashboard/history?executionId=${data.executionId}`);
                }
            } else {
                toast.error(`Job failed: ${data.error}`);
            }
        } catch { toast.error("Execution request failed"); }
    };

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
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    {row.original.source.name}
                </div>
            )
        },
        {
            accessorKey: "destination.name",
            header: "Destination",
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    {row.original.destination.name}
                </div>
            )
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
            id: "actions",
            header: () => <div className="text-right">Actions</div>,
            cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                     {canExecute && (
                        <Button variant="ghost" size="icon" onClick={() => runJob(row.original.id)} title="Run Now">
                            <Play className="h-4 w-4 text-green-500" />
                        </Button>
                    )}
                    {canManage && (
                        <>
                            <Button variant="ghost" size="icon" onClick={() => { setEditingJob(row.original); setIsDialogOpen(true); }}>
                                <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(row.original.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </>
                    )}
                </div>
            )
        }
    ], [canManage, canExecute]);

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
                    />
                </CardContent>
            </Card>


            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingJob ? "Edit Job" : "Create New Job"}</DialogTitle>
                    </DialogHeader>
                    {isDialogOpen && (
                        <JobForm
                            sources={sources}
                            destinations={destinations}
                            notifications={notificationChannels}
                            encryptionProfiles={encryptionProfiles}
                            initialData={editingJob}
                            onSuccess={() => { setIsDialogOpen(false); fetchJobs(); }}
                        />
                    )}
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
        </div>
    );
}
