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


    if (isLoading) {
        return (
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Backup Jobs</h2>
                        <p className="text-muted-foreground">Manage and schedule automated backup tasks.</p>
                    </div>
                    {canManage && <Skeleton className="h-10 w-32" />}
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <Card key={i} className="overflow-hidden">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-2">
                                        <Skeleton className="h-5 w-32" />
                                        <Skeleton className="h-3 w-24" />
                                    </div>
                                    <Skeleton className="h-8 w-16" />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 pt-2">
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-2/3" />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
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
                {canManage && (
                    <Button onClick={() => { setEditingJob(null); setIsDialogOpen(true); }}>
                        <Plus className="mr-2 h-4 w-4" /> Create Job
                    </Button>
                )}
            </div>

            {jobs.length === 0 ? (
                <div className="flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
                    <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                        <h3 className="mt-4 text-lg font-semibold">No jobs configured</h3>
                        <p className="mb-4 mt-2 text-sm text-muted-foreground">
                            Create your first backup job to start automating your database backups.
                        </p>
                        {canManage && (
                            <Button onClick={() => { setEditingJob(null); setIsDialogOpen(true); }}>
                                <Plus className="mr-2 h-4 w-4" /> Create Job
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {jobs.map((job) => (
                        <Card key={job.id} className="relative overflow-hidden group hover:border-primary/50 transition-colors">
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1">
                                        <CardTitle>{job.name}</CardTitle>
                                        <CardDescription className="flex items-center gap-2">
                                            <Clock className="h-3 w-3" /> {job.schedule}
                                        </CardDescription>
                                    </div>
                                    <div className="flex gap-1">
                                        {canExecute && (
                                            <Button variant="ghost" size="icon" onClick={() => runJob(job.id)} title="Run Now">
                                                <Play className="h-4 w-4 text-green-500" />
                                            </Button>
                                        )}
                                        {canManage && (
                                            <>
                                                <Button variant="ghost" size="icon" onClick={() => { setEditingJob(job); setIsDialogOpen(true); }}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(job.id)}>
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2 text-sm text-muted-foreground">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="capitalize flex items-center gap-1.5"><Badge variant={job.enabled ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">{job.enabled ? "Enabled" : "Paused"}</Badge></span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="capitalize">Source:</span>
                                        <span className="font-medium truncate max-w-30">{job.source.name}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="capitalize">Destination:</span>
                                        <span className="font-medium truncate max-w-30">{job.destination.name}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="capitalize">Notifications:</span>
                                        <span className="font-medium truncate max-w-30">{job.notifications.length} channels</span>
                                    </div>
                                    {job.encryptionProfile ? (
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="capitalize">Encryption:</span>
                                            <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400">
                                                <Lock className="h-2 w-2" /> {job.encryptionProfile.name}
                                            </Badge>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="capitalize">Encryption:</span>
                                            <span className="text-muted-foreground italic text-xs">Off</span>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

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
