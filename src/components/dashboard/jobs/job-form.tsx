"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export interface JobData {
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    sourceId: string;
    destinationId: string;
    encryptionProfileId?: string;
    notifications: { id: string, name: string }[];
}

export interface AdapterOption {
    id: string;
    name: string;
    adapterId: string;
}

export interface EncryptionOption {
    id: string;
    name: string;
}

const jobSchema = z.object({
    name: z.string().min(1, "Name is required"),
    schedule: z.string().min(1, "Cron schedule is required"),
    sourceId: z.string().min(1, "Source is required"),
    destinationId: z.string().min(1, "Destination is required"),
    encryptionProfileId: z.string().optional(),
    notificationIds: z.array(z.string()).optional(),
    enabled: z.boolean().default(true),
});

interface JobFormProps {
    sources: AdapterOption[];
    destinations: AdapterOption[];
    notifications: AdapterOption[];
    encryptionProfiles: EncryptionOption[];
    initialData: JobData | null;
    onSuccess: () => void;
}

export function JobForm({ sources, destinations, notifications, encryptionProfiles, initialData, onSuccess }: JobFormProps) {
    const form = useForm({
        resolver: zodResolver(jobSchema),
        defaultValues: {
            name: initialData?.name || "",
            schedule: initialData?.schedule || "0 0 * * *",
            sourceId: initialData?.sourceId || "",
            destinationId: initialData?.destinationId || "",
            encryptionProfileId: initialData?.encryptionProfileId || "",
            notificationIds: initialData?.notifications?.map((n) => n.id) || [],
            enabled: initialData?.enabled ?? true,
        }
    });

    const onSubmit = async (data: z.infer<typeof jobSchema>) => {
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
                 const result = await res.json();
                 toast.error(result.error || "Operation failed");
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
                                    {sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
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
                                    {destinations.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>

                <FormField control={form.control} name="encryptionProfileId" render={({ field }) => (
                    <FormItem>
                        <FormLabel className="flex items-center gap-2">
                            <Lock className="h-3 w-3" />
                            Encryption (Optional)
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value || ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="No Encryption" /></SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="">None (Unencrypted)</SelectItem>
                                {encryptionProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormDescription>
                            Select a key to encrypt the backup. Backups can only be restored if this key exists.
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />

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
                             const current = field.value || [];
                             if(!current.includes(val)) field.onChange([...current, val]);
                         }} >
                            <FormControl><SelectTrigger><SelectValue placeholder="Add Notification Channel" /></SelectTrigger></FormControl>
                             <SelectContent>
                                {notifications.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {field.value && field.value.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-2">
                                {field.value.map((id: string) => {
                                    const n = notifications.find((x) => x.id === id);
                                    return (
                                        <div key={id} className="bg-secondary text-secondary-foreground px-2 py-1 rounded text-xs flex items-center">
                                            {n?.name}
                                            <button type="button" onClick={() => field.onChange((field.value || []).filter((x: string) => x !== id))} className="ml-1 hover:text-destructive">×</button>
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
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                    </FormItem>
                )} />

                <Button type="submit" className="w-full">Save Job</Button>
            </form>
        </Form>
    )
}
