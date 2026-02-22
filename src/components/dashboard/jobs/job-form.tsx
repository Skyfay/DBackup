"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Lock, History, ChevronsUpDown } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

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
    notificationEvents?: string;
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
    notificationEvents: z.enum(["ALWAYS", "FAILURE_ONLY", "SUCCESS_ONLY"]).default("ALWAYS"),
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
    const [sourceOpen, setSourceOpen] = useState(false);
    const [destOpen, setDestOpen] = useState(false);
    const [notifyOpen, setNotifyOpen] = useState(false);

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
            notificationEvents: (initialData?.notificationEvents as "ALWAYS" | "FAILURE_ONLY" | "SUCCESS_ONLY") || "ALWAYS",
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                {/* Header: Name and Enabled */}
                <div className="flex flex-col md:flex-row gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem className="flex-1">
                            <FormLabel>Job Name</FormLabel>
                            <FormControl><Input placeholder="Daily Production Backup" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>

                <Tabs defaultValue="config" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="config">General</TabsTrigger>
                        <TabsTrigger value="retention">Retention</TabsTrigger>
                        <TabsTrigger value="security">Security</TabsTrigger>
                        <TabsTrigger value="notifications">Notify</TabsTrigger>
                    </TabsList>

                    {/* TAB 1: GENERAL (Source, Dest, Schedule) */}
                    <TabsContent value="config" className="space-y-4 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField control={form.control} name="sourceId" render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Source</FormLabel>
                                    <Popover open={sourceOpen} onOpenChange={setSourceOpen} modal={true}>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant="outline"
                                                    role="combobox"
                                                    aria-expanded={sourceOpen}
                                                    className={cn("w-full justify-between", !field.value && "text-muted-foreground")}
                                                >
                                                    {field.value ? (
                                                        <span className="flex items-center gap-2">
                                                            <AdapterIcon adapterId={sources.find((s) => s.id === field.value)?.adapterId ?? ""} className="h-4 w-4" />
                                                            {sources.find((s) => s.id === field.value)?.name}
                                                        </span>
                                                    ) : "Select Source"}
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                            <Command>
                                                <CommandInput placeholder="Search source..." />
                                                <CommandList>
                                                    <CommandEmpty>No source found.</CommandEmpty>
                                                    <CommandGroup>
                                                        {sources.map((s) => (
                                                            <CommandItem
                                                                value={s.name}
                                                                key={s.id}
                                                                onSelect={() => {
                                                                    form.setValue("sourceId", s.id);
                                                                    setSourceOpen(false);
                                                                }}
                                                                className={cn(field.value === s.id && "bg-accent")}
                                                            >
                                                                <AdapterIcon adapterId={s.adapterId} className="h-4 w-4" />
                                                                {s.name}
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="destinationId" render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Destination</FormLabel>
                                    <Popover open={destOpen} onOpenChange={setDestOpen} modal={true}>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant="outline"
                                                    role="combobox"
                                                    aria-expanded={destOpen}
                                                    className={cn("w-full justify-between", !field.value && "text-muted-foreground")}
                                                >
                                                    {field.value ? (
                                                        <span className="flex items-center gap-2">
                                                            <AdapterIcon adapterId={destinations.find((d) => d.id === field.value)?.adapterId ?? ""} className="h-4 w-4" />
                                                            {destinations.find((d) => d.id === field.value)?.name}
                                                        </span>
                                                    ) : "Select Destination"}
                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                            <Command>
                                                <CommandInput placeholder="Search destination..." />
                                                <CommandList>
                                                    <CommandEmpty>No destination found.</CommandEmpty>
                                                    <CommandGroup>
                                                        {destinations.map((d) => (
                                                            <CommandItem
                                                                value={d.name}
                                                                key={d.id}
                                                                onSelect={() => {
                                                                    form.setValue("destinationId", d.id);
                                                                    setDestOpen(false);
                                                                }}
                                                                className={cn(field.value === d.id && "bg-accent")}
                                                            >
                                                                <AdapterIcon adapterId={d.adapterId} className="h-4 w-4" />
                                                                {d.name}
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <FormField control={form.control} name="schedule" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Schedule (Cron)</FormLabel>
                                    <FormControl><Input placeholder="0 0 * * *" {...field} /></FormControl>
                                    <FormDescription>Min Hour Day Month Weekday</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />

                             <FormField control={form.control} name="enabled" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Active Status</FormLabel>
                                    <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3 py-2">
                                        <span className="text-sm text-muted-foreground">
                                            {field.value ? "Enabled" : "Disabled"}
                                        </span>
                                        <FormControl>
                                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                                        </FormControl>
                                    </div>
                                    <FormDescription>Enable automatic execution</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </TabsContent>

                    {/* TAB 2: RETENTION */}
                    <TabsContent value="retention" className="pt-4">
                         <Card className="border-border">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <History className="h-4 w-4" />
                                    Retention Strategy
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
                                                <div className="bg-muted p-4 rounded-md text-sm text-muted-foreground">
                                                    All backups will be kept indefinitely.
                                                    <br/><strong>Warning:</strong> This may fill up your storage quickly if you run backups frequently.
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="SIMPLE" className="pt-4">
                                                <FormField
                                                    control={form.control}
                                                    name="retention.simple.keepCount"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>Max Backups to Keep</FormLabel>
                                                            <FormControl>
                                                                <div className="flex items-center gap-2">
                                                                     <Input type="number" min={1} {...field} value={field.value as number} onChange={e => field.onChange(parseInt(e.target.value))} className="w-24" />
                                                                     <span className="text-sm text-muted-foreground">newest backups</span>
                                                                </div>
                                                            </FormControl>
                                                            <FormDescription>
                                                                Older backups exceeding this limit are deleted.
                                                            </FormDescription>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </TabsContent>

                                            <TabsContent value="SMART" className="pt-4 space-y-4">
                                                <p className="text-sm text-muted-foreground mb-4">
                                                    Grandfather-Father-Son rotation. Defines how many backups to keep for each time period.
                                                </p>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="retention.smart.daily"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>Daily</FormLabel>
                                                                <FormControl><Input type="number" min={0} {...field} value={field.value as number} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                                <FormDescription>Days</FormDescription>
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <FormField
                                                        control={form.control}
                                                        name="retention.smart.weekly"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>Weekly</FormLabel>
                                                                <FormControl><Input type="number" min={0} {...field} value={field.value as number} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                                <FormDescription>Weeks</FormDescription>
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <FormField
                                                        control={form.control}
                                                        name="retention.smart.monthly"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>Monthly</FormLabel>
                                                                <FormControl><Input type="number" min={0} {...field} value={field.value as number} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                                <FormDescription>Months</FormDescription>
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <FormField
                                                        control={form.control}
                                                        name="retention.smart.yearly"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>Yearly</FormLabel>
                                                                <FormControl><Input type="number" min={0} {...field} value={field.value as number} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl>
                                                                <FormDescription>Years</FormDescription>
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
                    </TabsContent>

                    {/* TAB 3: SECURITY & OPTIMIZATION */}
                    <TabsContent value="security" className="space-y-4 pt-4">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField control={form.control} name="encryptionProfileId" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center gap-2">
                                        <Lock className="h-3 w-3" />
                                        Encryption
                                    </FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value || "no-encryption"}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="No Encryption" /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="no-encryption">None (Unencrypted)</SelectItem>
                                            {encryptionProfiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>
                                        Requires key to restore.
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
                                    <FormDescription>Trade CPU for storage.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                    </TabsContent>

                    {/* TAB 4: NOTIFICATIONS */}
                    <TabsContent value="notifications" className="pt-4 space-y-4">
                        <FormField control={form.control} name="notificationEvents" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Notification Trigger</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select trigger" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="ALWAYS">Always (Success & Failure)</SelectItem>
                                        <SelectItem value="FAILURE_ONLY">On Failure Only</SelectItem>
                                        <SelectItem value="SUCCESS_ONLY">On Success Only</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormDescription>Choose when to send alerts.</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )} />

                        <FormField control={form.control} name="notificationIds" render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Active Notification Channels</FormLabel>
                                <Popover open={notifyOpen} onOpenChange={setNotifyOpen} modal={true}>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={notifyOpen}
                                                className="w-full justify-between"
                                            >
                                                Add Notification Channel
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                        <Command>
                                            <CommandInput placeholder="Search notifications..." />
                                            <CommandList>
                                                <CommandEmpty>No channel found.</CommandEmpty>
                                                <CommandGroup>
                                                    {notifications.map((n) => (
                                                        <CommandItem
                                                            value={n.name}
                                                            key={n.id}
                                                            onSelect={() => {
                                                                const current = field.value || [];
                                                                if (!current.includes(n.id)) {
                                                                    field.onChange([...current, n.id]);
                                                                } else {
                                                                    // Toggle off if already selected?
                                                                    // Usually multi-select comboboxes allow toggling
                                                                    field.onChange(current.filter(id => id !== n.id));
                                                                }
                                                                // setNotifyOpen(false); // Keep open for multi-select convenience? OR close it.
                                                                // Standard shadcn behavior is often to close, but for multi-select staying open is nicer.
                                                                // Let's close it to match other inputs behavior for now, or keep it open?
                                                                // User might want to add multiple at once.
                                                                // But I will keep it simple: Select -> Close.
                                                                // Actually, toggling is better UX.
                                                                // Let's allow toggle and keep OPEN ? No, standard is close.
                                                                setNotifyOpen(false);
                                                            }}
                                                            className={cn((field.value || []).includes(n.id) && "bg-accent")}
                                                        >
                                                            <AdapterIcon adapterId={n.adapterId} className="h-4 w-4" />
                                                            {n.name}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                <div className="min-h-25 border rounded-md mt-2 p-2">
                                    {field.value && field.value.length > 0 ? (
                                        <div className="flex gap-2 flex-wrap">
                                            {field.value.map((id: string) => {
                                                const n = notifications.find((x) => x.id === id);
                                                return (
                                                    <div key={id} className="bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm flex items-center shadow-sm">
                                                        {n?.name}
                                                        <button type="button" onClick={() => field.onChange((field.value || []).filter((x: string) => x !== id))} className="ml-2 hover:text-destructive font-bold">×</button>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground p-2 italic">No notifications configured.</p>
                                    )}
                                </div>
                                <FormDescription>
                                    Selected channels will receive alerts on backup success/failure.
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )} />
                    </TabsContent>
                </Tabs>

                <div className="pt-4 border-t">
                    <Button type="submit" className="w-full">Save Job Configuration</Button>
                </div>
            </form>
        </Form>
    )
}
