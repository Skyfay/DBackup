"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { Edit, Play, Trash2, Plus, Clock, Pause, CheckCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

interface Job {
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    sourceId: string;
    destinationId: string;
    source: { name: string, type: string };
    destination: { name: string, type: string };
    notifications: { id: string, name: string }[];
    createdAt: string;
}

interface AdapterOption {
    id: string;
    name: string;
    adapterId: string;
}

const jobSchema = z.object({
    name: z.string().min(1, "Name is required"),
    schedule: z.string().min(1, "Cron schedule is required"),
    sourceId: z.string().min(1, "Source is required"),
    destinationId: z.string().min(1, "Destination is required"),
    notificationIds: z.array(z.string()).optional(),
    enabled: z.boolean().default(true),
});

export default function JobsPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [sources, setSources] = useState<AdapterOption[]>([]);
    const [destinations, setDestinations] = useState<AdapterOption[]>([]);
    const [notificationChannels, setNotificationChannels] = useState<AdapterOption[]>([]);

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingJob, setEditingJob] = useState<Job | null>(null);

    useEffect(() => {
        fetchJobs();
        fetchAdapters();
    }, []);

    const fetchJobs = async () => {
        try {
            const res = await fetch("/api/jobs");
            if (res.ok) setJobs(await res.json());
        } catch (error) { toast.error("Failed to fetch jobs"); }
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
        } catch (error) { toast.error("Failed to fetch adapters"); }
    };

    const handleDelete = async (id: string) => {
         if (!confirm("Are you sure?")) return;
         try {
             await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
             fetchJobs();
             toast.success("Job deleted");
         } catch(e) { toast.error("Failed to delete"); }
    };

     const handleRunMatch = async (id: string) => {
        toast.promise(
            fetch(`/api/jobs/${id}/run`, { method: "POST" }).then(async (res) => {
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || "Failed");
                return data;
            }),
            {
                loading: "Starting backup job...",
                success: "Job executed successfully",
                error: (err) => `Job failed: ${err.message}`
            }
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                     <h2 className="text-3xl font-bold tracking-tight">Backup Jobs</h2>
                     <p className="text-muted-foreground">Manage automated backup schedules.</p>
                </div>
                <Button onClick={() => { setEditingJob(null); setIsDialogOpen(true); }}>
                    <Plus className="mr-2 h-4 w-4" /> Create Job
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {jobs.map(job => (
                    <Card key={job.id} className={job.enabled ? "" : "opacity-75"}>
                        <CardHeader className="pb-3">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-lg">{job.name}</CardTitle>
                                {job.enabled ?
                                    <CheckCircle className="h-4 w-4 text-green-500" /> :
                                    <Pause className="h-4 w-4 text-yellow-500" />
                                }
                            </div>
                            <CardDescription className="flex items-center text-xs mt-1">
                                 <Clock className="w-3 h-3 mr-1" /> {job.schedule}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-muted-foreground">Source</span>
                                <span className="font-medium">{job.source.name}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-muted-foreground">Destination</span>
                                <span className="font-medium">{job.destination.name}</span>
                            </div>
                             <div className="flex justify-between">
                                <span className="text-muted-foreground">Notifications</span>
                                <span className="font-medium">{job.notifications.length} channels</span>
                            </div>
                        </CardContent>
                        <CardFooter className="flex justify-end gap-2 pt-2">
                             <Button variant="outline" size="sm" onClick={() => handleRunMatch(job.id)}>
                                <Play className="h-3 w-3 mr-1" /> Run
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => { setEditingJob(job); setIsDialogOpen(true); }}>
                                <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(job.id)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>

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
                            initialData={editingJob}
                            onSuccess={() => { setIsDialogOpen(false); fetchJobs(); }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function JobForm({ sources, destinations, notifications, initialData, onSuccess }: any) {
    const form = useForm({
        resolver: zodResolver(jobSchema),
        defaultValues: {
            name: initialData?.name || "",
            schedule: initialData?.schedule || "0 0 * * *",
            sourceId: initialData?.sourceId || "",
            destinationId: initialData?.destinationId || "",
            notificationIds: initialData?.notifications?.map((n: any) => n.id) || [],
            enabled: initialData?.enabled ?? true,
        }
    });

    const onSubmit = async (data: any) => {
         try {
            const url = initialData ? `/api/jobs/${initialData.id}` : '/api/jobs';
            const method = initialData ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (res.ok) {
                toast.success(initialData ? "Job updated" : "Job created");
                onSuccess();
            } else {
                toast.error("Operation failed");
            }
        } catch { toast.error("Error occurred"); }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                 <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Job Name</FormLabel>
                        <FormControl><Input placeholder="Daily Production Backup" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="sourceId" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Source</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select Source" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {sources.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />

                    <FormField control={form.control} name="destinationId" render={({ field }) => (
                         <FormItem>
                            <FormLabel>Destination</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select Destination" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {destinations.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>

                <FormField control={form.control} name="schedule" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Schedule (Cron)</FormLabel>
                        <FormControl><Input placeholder="0 0 * * *" {...field} /></FormControl>
                        <FormDescription>Standard cron expression (e.g. 0 0 * * * for daily at midnight)</FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />

                 <FormField control={form.control} name="notificationIds" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Notifications (Optional)</FormLabel>
                         <Select onValueChange={(val) => {
                             // Simple hack for multi-select simulation or just enable single select for now to save time
                             // Let's just do single select for simplicity in this iteration or handle array logic manually if Shadcn select supported multiple (it doesn't out of box easily)
                             // Actually, let's just allow picking ONE notification channel for now to keep UI simple, or assume field expects array but we give it one.
                             const current = field.value || [];
                             if(!current.includes(val)) field.onChange([...current, val]);
                         }} >
                            <FormControl><SelectTrigger><SelectValue placeholder="Add Notification Channel" /></SelectTrigger></FormControl>
                             <SelectContent>
                                {notifications.map((n: any) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {field.value?.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-2">
                                {field.value.map((id: string) => {
                                    const n = notifications.find((x: any) => x.id === id);
                                    return (
                                        <div key={id} className="bg-secondary text-secondary-foreground px-2 py-1 rounded text-xs flex items-center">
                                            {n?.name}
                                            <button type="button" onClick={() => field.onChange(field.value.filter((x: string) => x !== id))} className="ml-1 hover:text-destructive">×</button>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                        <FormMessage />
                    </FormItem>
                )} />

                <FormField control={form.control} name="enabled" render={({ field }) => (
                     <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                            <FormLabel>Enabled</FormLabel>
                            <FormDescription>Pause automated execution without deleting</FormDescription>
                        </div>
                        <FormControl>
                            <input type="checkbox" checked={field.value} onChange={field.onChange} className="h-4 w-4" />
                        </FormControl>
                    </FormItem>
                )} />

                <Button type="submit" className="w-full">Save Job</Button>
            </form>
        </Form>
    )
}
