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
import { Lock, History, Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface JobData {
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    sourceId: string;
    destinationId: string;
    encryptionProfileId?: string;
    compression: string;
    retention: string;
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
    compression: z.enum(["NONE", "GZIP", "BROTLI"]).default("NONE"),
    notificationIds: z.array(z.string()).optional(),
    enabled: z.boolean().default(true),
    retention: z.object({
        mode: z.enum(["NONE", "SIMPLE", "SMART"]),
        simple: z.object({
            keepCount: z.coerce.number().min(1).default(10)
        }).optional(),
        smart: z.object({
            daily: z.coerce.number().min(0).default(7),
            weekly: z.coerce.number().min(0).default(4),
            monthly: z.coerce.number().min(0).default(12),
            yearly: z.coerce.number().min(0).default(2),
        }).optional()
    })
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

    const defaultRetention = initialData?.retention ? JSON.parse(initialData.retention) : { mode: "NONE", simple: { keepCount: 10 }, smart: { daily: 7, weekly: 4, monthly: 12, yearly: 2 } };
    // Ensure structure even if JSON is partial
    if (!defaultRetention.simple) defaultRetention.simple = { keepCount: 10 };
    if (!defaultRetention.smart) defaultRetention.smart = { daily: 7, weekly: 4, monthly: 12, yearly: 2 };

    const form = useForm({
        resolver: zodResolver(jobSchema),
        defaultValues: {
            name: initialData?.name || "",
            schedule: initialData?.schedule || "0 0 * * *",
            sourceId: initialData?.sourceId || "",
            destinationId: initialData?.destinationId || "",
            encryptionProfileId: initialData?.encryptionProfileId || "no-encryption",
            compression: (initialData?.compression as "NONE" | "GZIP" | "BROTLI") || "NONE",
            notificationIds: initialData?.notifications?.map((n) => n.id) || [],
            enabled: initialData?.enabled ?? true,
            retention: defaultRetention
        }
    });

    const onSubmit = async (data: z.infer<typeof jobSchema>) => {
         try {
            const url = initialData ? `/api/jobs/${initialData.id}` : '/api/jobs';
            const method = initialData ? 'PUT' : 'POST';

            // Clean payload
            const payload = {
                ...data,
                encryptionProfileId: data.encryptionProfileId === "no-encryption" ? "" : data.encryptionProfileId
            };

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
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
                        <Select onValueChange={field.onChange} defaultValue={field.value || "no-encryption"}>
                            <FormControl><SelectTrigger><SelectValue placeholder="No Encryption" /></SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="no-encryption">None (Unencrypted)</SelectItem>
                                {encryptionProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormDescription>
                            Select a key to encrypt the backup. Backups can only be restored if this key exists.
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )} />

                <FormField control={form.control} name="compression" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Compression</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select compression" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="NONE">None (Fastest)</SelectItem>
                                <SelectItem value="GZIP">Gzip (Standard)</SelectItem>
                                <SelectItem value="BROTLI">Brotli (Best Compression)</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormDescription>Compress the backup file to save storage space.</FormDescription>
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

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <History className="h-4 w-4" />
                            Retention Policy
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <FormField
                            control={form.control}
                            name="retention.mode"
                            render={({ field }) => (
                                <Tabs value={field.value} onValueChange={field.onChange} className="w-full">
                                    <TabsList className="grid w-full grid-cols-3">
                                        <TabsTrigger value="NONE">Keep All</TabsTrigger>
                                        <TabsTrigger value="SIMPLE">Simple Limit</TabsTrigger>
                                        <TabsTrigger value="SMART">Smart Rotation</TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="NONE" className="pt-4">
                                        <p className="text-sm text-muted-foreground">
                                            All backups will be kept indefinitely.
                                            <br/>Warning: This may fill up your storage quickly.
                                        </p>
                                    </TabsContent>

                                    <TabsContent value="SIMPLE" className="pt-4">
                                        <FormField
                                            control={form.control}
                                            name="retention.simple.keepCount"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Max Backups to Keep</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" min={1} {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                                                    </FormControl>
                                                    <FormDescription>
                                                        Only the newest {field.value} backups will be kept. Older ones are deleted.
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </TabsContent>

                                    <TabsContent value="SMART" className="pt-4 space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField
                                                control={form.control}
                                                name="retention.smart.daily"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Daily Backups</FormLabel>
                                                        <FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                        <FormDescription>Keep for X days</FormDescription>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="retention.smart.weekly"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Weekly Backups</FormLabel>
                                                        <FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                        <FormDescription>Keep for X weeks</FormDescription>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="retention.smart.monthly"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Monthly Backups</FormLabel>
                                                        <FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                        <FormDescription>Keep for X months</FormDescription>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="retention.smart.yearly"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Yearly Backups</FormLabel>
                                                        <FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                        <FormDescription>Keep for X years</FormDescription>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </TabsContent>
                                </Tabs>
                            )}
                        />
                    </CardContent>
                </Card>

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
