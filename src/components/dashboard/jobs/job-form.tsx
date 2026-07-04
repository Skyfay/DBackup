"use client";

import { useState, useCallback, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Lock, History, ChevronsUpDown, Plus, Trash2, ChevronDown, ChevronRight, Database, Info, Loader2, FileText, CalendarClock, Pencil } from "lucide-react";
import { SchedulePicker } from "./schedule-picker";
import { RetentionPolicyPicker, DEFAULT_RETENTION_SENTINEL } from "@/components/templates/retention-policy-picker";
import { NamingTemplatePicker } from "@/components/templates/naming-template-picker";
import { NotificationTemplatePicker } from "@/components/templates/notification-template-picker";
import { getSchedulePresets, getNotificationTemplates } from "@/app/actions/templates";
import type { SchedulePreset } from "@prisma/client";
import { SchedulePresetDialog } from "@/components/settings/templates/schedule-preset-list";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { DatabasePicker } from "@/components/adapter/database-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible"

const retentionSchema = z.object({
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
});

const destinationSchema = z.object({
    configId: z.string().min(1, "Destination is required"),
    retention: retentionSchema,
    retentionPolicyId: z.string().optional(),
});

export interface JobData {
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    sourceId: string;
    databases?: string;
    encryptionProfileId?: string;
    compression: string;
    pgCompression?: string;
    notificationEvents?: string;
    namingTemplateId?: string | null;
    schedulePresetId?: string | null;
    schedulePreset?: { id: string; name: string; schedule: string } | null;
    skipVerification?: boolean;
    notifications: { id: string, name: string }[];
    notificationTemplates?: { templateId: string; priority: number }[];
    destinations: {
        configId: string;
        priority: number;
        retention: string;
        retentionPolicyId?: string | null;
    }[];
}

export interface AdapterOption {
    id: string;
    name: string;
    adapterId: string;
    metadata?: string | null;
}

export interface EncryptionOption {
    id: string;
    name: string;
}

type PgCompressionAlgo = "LEGACY" | "NONE" | "GZIP" | "LZ4" | "ZSTD";

const PG_LEVEL_CONSTRAINTS: Record<string, { min: number; max: number; default: number; values: number[] }> = {
    GZIP: { min: 0, max: 9, default: 6, values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    LZ4:  { min: 0, max: 9, default: 1, values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    ZSTD: { min: 1, max: 22, default: 3, values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] },
};

/** Extract the major version number from a version string like "16.2" or "PostgreSQL 14.1" */
function parsePgMajorVersion(metadata: string | null | undefined): number | null {
    if (!metadata) return null;
    try {
        const parsed = JSON.parse(metadata);
        const version: string = parsed.engineVersion || parsed.version || "";
        const match = version.match(/(\d+)\./);
        return match ? parseInt(match[1], 10) : null;
    } catch {
        return null;
    }
}

function parsePgCompression(pgCompression: string | undefined): { algo: PgCompressionAlgo; level: number } {
    if (!pgCompression || pgCompression === "") return { algo: "LEGACY", level: 6 };
    if (pgCompression === "NONE") return { algo: "NONE", level: 0 };
    const colonIdx = pgCompression.indexOf(":");
    if (colonIdx === -1) return { algo: "LEGACY", level: 6 };
    const algo = pgCompression.slice(0, colonIdx).toUpperCase() as PgCompressionAlgo;
    const level = parseInt(pgCompression.slice(colonIdx + 1), 10);
    return { algo, level: isNaN(level) ? (PG_LEVEL_CONSTRAINTS[algo]?.default ?? 6) : level };
}

const jobSchema = z.object({
    name: z.string().min(1, "Name is required"),
    schedule: z.string().min(1, "Cron schedule is required"),
    sourceId: z.string().min(1, "Source is required"),
    databases: z.array(z.string()).default([]),
    destinations: z.array(destinationSchema).min(1, "At least one destination is required"),
    encryptionProfileId: z.string().optional(),
    namingTemplateId: z.string().optional(),
    compression: z.enum(["NONE", "GZIP", "BROTLI"]).default("NONE"),
    pgCompressionAlgo: z.enum(["LEGACY", "NONE", "GZIP", "LZ4", "ZSTD"]).default("LEGACY"),
    pgCompressionLevel: z.coerce.number().int().min(0).max(22).default(6),
    notificationIds: z.array(z.string()).optional(),
    notificationEvents: z.array(z.enum(["SUCCESS", "PARTIAL", "FAILED"])).default(["SUCCESS", "PARTIAL", "FAILED"]),
    notificationTemplateIds: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
    skipVerification: z.boolean().default(false),
});

const defaultRetentionValue = { mode: "NONE" as const, simple: { keepCount: 10 }, smart: { daily: 7, weekly: 4, monthly: 12, yearly: 2 } };

interface JobFormProps {
    sources: AdapterOption[];
    destinations: AdapterOption[];
    notifications: AdapterOption[];
    encryptionProfiles: EncryptionOption[];
    initialData: {
        id: string;
        name: string;
        schedule: string;
        enabled: boolean;
        sourceId: string;
        databases?: string;
        encryptionProfileId?: string;
        compression: string;
        pgCompression?: string;
        notificationEvents?: string;
        namingTemplateId?: string | null;
        schedulePresetId?: string | null;
        schedulePreset?: { id: string; name: string; schedule: string } | null;
        skipVerification?: boolean;
        notifications: { id: string; name: string }[];
        notificationTemplates?: { templateId: string; priority: number }[];
        destinations: { configId: string; priority: number; retention: string; retentionPolicyId?: string | null }[];
    } | null;
    onSuccess: () => void;
}

function parseRetention(retentionStr: string) {
    try {
        const parsed = JSON.parse(retentionStr);
        if (!parsed.simple) parsed.simple = { keepCount: 10 };
        if (!parsed.smart) parsed.smart = { daily: 7, weekly: 4, monthly: 12, yearly: 2 };
        if (!parsed.mode) parsed.mode = "NONE";
        return parsed;
    } catch {
        return { ...defaultRetentionValue };
    }
}

/**
 * Resolves the initial retentionPolicyId for a destination loaded from the DB.
 * - Explicit policy ID → return that ID
 * - null + empty retention (retention = '{}') → return DEFAULT_RETENTION_SENTINEL (use system default)
 * - null + explicit mode (e.g. NONE) in retention → return undefined (no policy)
 */
function parseNotificationEvents(raw?: string | null): Array<"SUCCESS" | "PARTIAL" | "FAILED"> {
    if (!raw) return ["SUCCESS", "PARTIAL", "FAILED"];
    // Handle legacy enum values
    if (raw === "ALWAYS") return ["SUCCESS", "PARTIAL", "FAILED"];
    if (raw === "FAILURE_ONLY") return ["PARTIAL", "FAILED"];
    if (raw === "SUCCESS_ONLY") return ["SUCCESS"];
    const valid = new Set(["SUCCESS", "PARTIAL", "FAILED"]);
    return raw.split("|").filter(v => valid.has(v)) as Array<"SUCCESS" | "PARTIAL" | "FAILED">;
}

function resolveInitialRetentionPolicyId(d: { retentionPolicyId?: string | null; retention: string }): string | undefined {
    if (d.retentionPolicyId) return d.retentionPolicyId;
    if (!d.retention || d.retention === "{}") return DEFAULT_RETENTION_SENTINEL;
    return undefined;
}

export function JobForm({ sources, destinations, notifications: _notifications, encryptionProfiles, initialData, onSuccess }: JobFormProps) {
    const [sourceOpen, setSourceOpen] = useState(false);
    const [expandedDests, setExpandedDests] = useState<Set<number>>(new Set());
    const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
    const [isLoadingDbs, setIsLoadingDbs] = useState(false);
    const [isDbListOpen, setIsDbListOpen] = useState(false);
    const [useSchedulePreset, setUseSchedulePreset] = useState(false);
    const [schedulePresets, setSchedulePresets] = useState<SchedulePreset[]>([]);
    const [presetOpen, setPresetOpen] = useState(false);
    const [linkedPresetId, setLinkedPresetId] = useState<string | null>(initialData?.schedulePresetId ?? null);
    const [linkedPresetName, setLinkedPresetName] = useState<string | null>(initialData?.schedulePreset?.name ?? null);
    const [presetCreateOpen, setPresetCreateOpen] = useState(false);
    const [presetEditTarget, setPresetEditTarget] = useState<SchedulePreset | null>(null);
    const [presetEditOpen, setPresetEditOpen] = useState(false);

    // Parse initial databases from JSON string
    const parseInitialDatabases = (): string[] => {
        if (!initialData?.databases) return [];
        try {
            const parsed = JSON.parse(initialData.databases);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    };

    const defaultDestinations = initialData?.destinations?.length
        ? initialData.destinations.map(d => ({
            configId: d.configId,
            retention: parseRetention(d.retention),
            retentionPolicyId: resolveInitialRetentionPolicyId(d),
        }))
        : [{ configId: "", retention: { ...defaultRetentionValue }, retentionPolicyId: DEFAULT_RETENTION_SENTINEL }];

    const form = useForm({
        resolver: zodResolver(jobSchema),
        defaultValues: {
            name: initialData?.name || "",
            schedule: initialData?.schedule || "0 0 * * *",
            sourceId: initialData?.sourceId || "",
            databases: parseInitialDatabases(),
            destinations: defaultDestinations,
            encryptionProfileId: initialData?.encryptionProfileId || "no-encryption",
            compression: (initialData?.compression as "NONE" | "GZIP" | "BROTLI") || "NONE",
            pgCompressionAlgo: parsePgCompression(initialData?.pgCompression).algo,
            pgCompressionLevel: parsePgCompression(initialData?.pgCompression).level,
            namingTemplateId: initialData?.namingTemplateId || undefined,
            notificationIds: initialData?.notifications?.map((n) => n.id) || [],
            notificationEvents: parseNotificationEvents(initialData?.notificationEvents),
            notificationTemplateIds: initialData?.notificationTemplates?.map((t) => t.templateId) || [],
            enabled: initialData?.enabled ?? true,
            skipVerification: initialData?.skipVerification ?? false,
        }
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "destinations",
    });

    const toggleExpanded = (index: number) => {
        setExpandedDests(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    // Load schedule presets on mount
    useEffect(() => {
        getSchedulePresets().then((res) => {
            if (res.success && res.data) setSchedulePresets(res.data);
        });
    }, []);

    // Pre-select the default notification template for new jobs only.
    // Does not override an existing selection (e.g. when editing).
    useEffect(() => {
        if (initialData) return;
        getNotificationTemplates().then((res) => {
            if (!res.success || !res.data) return;
            const defaultTemplate = res.data.find((t) => t.isDefault);
            if (defaultTemplate && (form.getValues("notificationTemplateIds") ?? []).length === 0) {
                form.setValue("notificationTemplateIds", [defaultTemplate.id]);
            }
        });
    }, [initialData, form]);

    // Determine whether to show database picker based on selected source adapter
    const selectedSourceId = form.watch("sourceId");
    const selectedSource = sources.find(s => s.id === selectedSourceId);
    const showDatabasePicker = selectedSource && !["sqlite", "redis", "valkey"].includes(selectedSource.adapterId);
    const isPgSource = selectedSource?.adapterId === "postgres";
    const pgMajorVersion = isPgSource ? parsePgMajorVersion(selectedSource?.metadata) : null;

    const pgCompressionAlgo = (form.watch("pgCompressionAlgo") ?? "LEGACY") as PgCompressionAlgo;
    const isNativeCompressionActive = isPgSource && ["LEGACY", "GZIP", "LZ4", "ZSTD"].includes(pgCompressionAlgo);

    // Auto-disable external compression when native pg compression is active
    useEffect(() => {
        if (isNativeCompressionActive) {
            form.setValue("compression", "NONE");
        }
    }, [isNativeCompressionActive, form]);

    // Reset pgCompression when source changes to a non-PG adapter,
    // or when the selected algo is incompatible with the detected PG version.
    useEffect(() => {
        const algo = form.getValues("pgCompressionAlgo") as PgCompressionAlgo;
        if (!isPgSource) {
            // Source is not PostgreSQL - clear any pg-specific settings silently
            if (algo !== "LEGACY") {
                form.setValue("pgCompressionAlgo", "LEGACY", { shouldDirty: false });
                form.setValue("pgCompressionLevel", 6, { shouldDirty: false });
            }
            return;
        }
        if (pgMajorVersion !== null) {
            if (algo === "LZ4" && pgMajorVersion < 14) {
                form.setValue("pgCompressionAlgo", "LEGACY", { shouldDirty: true });
                form.setValue("pgCompressionLevel", 6, { shouldDirty: true });
            } else if (algo === "ZSTD" && pgMajorVersion < 16) {
                form.setValue("pgCompressionAlgo", "LEGACY", { shouldDirty: true });
                form.setValue("pgCompressionLevel", 6, { shouldDirty: true });
            }
        }
    }, [selectedSourceId, pgMajorVersion, isPgSource, form]);

    const fetchDatabases = useCallback(async () => {
        if (!selectedSourceId) return;
        setIsLoadingDbs(true);
        try {
            const res = await fetch(`/api/adapters/${encodeURIComponent(selectedSourceId)}/databases`);
            const data = await res.json();
            if (data.success && Array.isArray(data.databases)) {
                setAvailableDatabases(data.databases);
                setIsDbListOpen(true);

                // Remove any selected databases that no longer exist on server
                const currentDbs = form.getValues("databases") || [];
                if (currentDbs.length > 0) {
                    const valid = currentDbs.filter((db: string) => data.databases.includes(db));
                    if (valid.length !== currentDbs.length) {
                        form.setValue("databases", valid, { shouldDirty: true });
                        toast.warning(`Removed ${currentDbs.length - valid.length} unavailable database(s)`);
                    }
                }
                toast.success(`Loaded ${data.databases.length} databases`);
            } else {
                toast.error(data.error || "Failed to load databases");
            }
        } catch {
            toast.error("Failed to fetch databases");
        } finally {
            setIsLoadingDbs(false);
        }
    }, [selectedSourceId, form]);

    const onSubmit = async (data: z.infer<typeof jobSchema>) => {
         try {
            const url = initialData ? `/api/jobs/${initialData.id}` : '/api/jobs';
            const method = initialData ? 'PUT' : 'POST';

            // Combine algo + level into a single pgCompression string for the API
            // Only send pgCompression for PostgreSQL sources - clear it for all other adapters
            const currentSource = sources.find(s => s.id === data.sourceId);
            const isPostgres = currentSource?.adapterId === "postgres";
            let pgCompression: string;
            if (!isPostgres) {
                pgCompression = "";
            } else {
                const algo = data.pgCompressionAlgo;
                if (algo === "LEGACY") {
                    pgCompression = "";
                } else if (algo === "NONE") {
                    pgCompression = "NONE";
                } else {
                    pgCompression = `${algo}:${data.pgCompressionLevel}`;
                }
            }

            const { pgCompressionAlgo: _algo, pgCompressionLevel: _level, ...rest } = data;
            const payload = {
                ...rest,
                notificationTemplateIds: data.notificationTemplateIds || [],
                notificationEvents: data.notificationEvents.join("|") || "SUCCESS|PARTIAL|FAILED",
                skipVerification: data.skipVerification,
                pgCompression,
                encryptionProfileId: data.encryptionProfileId === "no-encryption" ? "" : data.encryptionProfileId,
                namingTemplateId: data.namingTemplateId || null,
                schedulePresetId: linkedPresetId ?? null,
                databases: data.databases || [],
                destinations: data.destinations.map((d, i) => ({
                    configId: d.configId,
                    priority: i,
                    // DEFAULT_RETENTION_SENTINEL means "use system default": save empty retention + null policyId
                    // so 01-initialize.ts falls through to the system default lookup.
                    retention: d.retentionPolicyId === DEFAULT_RETENTION_SENTINEL ? {} : d.retention,
                    retentionPolicyId: d.retentionPolicyId === DEFAULT_RETENTION_SENTINEL ? null : (d.retentionPolicyId || null),
                }))
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

    // Get used destination IDs to prevent duplicates
    const usedDestIds = form.watch("destinations").map(d => d.configId).filter(Boolean);

    return (
        <>
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                {/* Header: Name */}
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
                        <TabsTrigger value="destinations">Destinations</TabsTrigger>
                        <TabsTrigger value="advanced">Advanced</TabsTrigger>
                        <TabsTrigger value="notifications">Notify</TabsTrigger>
                    </TabsList>

                    {/* TAB 1: GENERAL (Source, Active Status, Schedule) */}
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
                                                        <span className="flex items-center gap-2 min-w-0">
                                                            <AdapterIcon adapterId={sources.find((s) => s.id === field.value)?.adapterId ?? ""} className="h-4 w-4 shrink-0" />
                                                            <span className="truncate">{sources.find((s) => s.id === field.value)?.name}</span>
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
                                                                    const prevSourceId = form.getValues("sourceId");
                                                                    form.setValue("sourceId", s.id);
                                                                    setSourceOpen(false);
                                                                    // Reset databases when source changes
                                                                    if (prevSourceId !== s.id) {
                                                                        form.setValue("databases", []);
                                                                        setAvailableDatabases([]);
                                                                    }
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

                            <FormField control={form.control} name="enabled" render={({ field }) => (
                                <FormItem className="flex flex-col">
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

                        {/* Database Picker (hidden for SQLite/Redis) */}
                        {showDatabasePicker && (
                            <FormField control={form.control} name="databases" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="flex items-center gap-2">
                                        <Database className="h-3 w-3" />
                                        Databases
                                    </FormLabel>
                                    <FormControl>
                                        <DatabasePicker
                                            value={field.value}
                                            onChange={field.onChange}
                                            availableDatabases={availableDatabases}
                                            isLoading={isLoadingDbs}
                                            onLoad={fetchDatabases}
                                            isOpen={isDbListOpen}
                                            setIsOpen={setIsDbListOpen}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Select specific databases to back up. Leave empty to back up all databases.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        )}

                        <FormField control={form.control} name="schedule" render={({ field }) => (
                            <FormItem>
                                <div className="flex items-center justify-between mb-1">
                                    <FormLabel>Schedule</FormLabel>
                                    <div className="flex items-center gap-1.5">
                                        {!linkedPresetId && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => setUseSchedulePreset(false)}
                                                    className={cn("text-xs px-2 py-0.5 rounded transition-colors", !useSchedulePreset ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                                                >
                                                    Custom
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setUseSchedulePreset(true)}
                                                    className={cn("text-xs px-2 py-0.5 rounded transition-colors flex items-center gap-1", useSchedulePreset ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                                                >
                                                    <CalendarClock className="h-3 w-3" />
                                                    Link Preset
                                                </button>
                                            </>
                                        )}
                                        {linkedPresetId && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setLinkedPresetId(null);
                                                    setLinkedPresetName(null);
                                                }}
                                                className="text-xs px-2 py-0.5 rounded transition-colors text-muted-foreground hover:text-foreground flex items-center gap-1"
                                            >
                                                Unlink
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {linkedPresetId ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span className="flex-1 font-medium">{linkedPresetName}</span>
                                            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                                {schedulePresets.find(p => p.id === linkedPresetId)?.schedule ?? field.value}
                                            </code>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Schedule is controlled by this preset. Changes to the preset apply to this job automatically.
                                        </p>
                                    </div>
                                ) : useSchedulePreset ? (
                                    <Popover open={presetOpen} onOpenChange={setPresetOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                                                <span className="flex items-center gap-2 text-muted-foreground">
                                                    <CalendarClock className="h-3.5 w-3.5" />
                                                    Select a preset to link...
                                                </span>
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                            <Command>
                                                <CommandInput placeholder="Search presets..." />
                                                <CommandList>
                                                    <CommandEmpty>No presets found.</CommandEmpty>
                                                    <CommandGroup>
                                                        {schedulePresets.map((preset) => (
                                                            <CommandItem
                                                                key={preset.id}
                                                                value={preset.name}
                                                                className="group pr-1"
                                                                onSelect={() => {
                                                                    field.onChange(preset.schedule);
                                                                    setLinkedPresetId(preset.id);
                                                                    setLinkedPresetName(preset.name);
                                                                    setPresetOpen(false);
                                                                    setUseSchedulePreset(false);
                                                                }}
                                                            >
                                                                <span className="flex-1">{preset.name}</span>
                                                                <code className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{preset.schedule}</code>
                                                                <button
                                                                    type="button"
                                                                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 rounded p-0.5 hover:bg-accent"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setPresetOpen(false);
                                                                        setPresetEditTarget(preset);
                                                                        setPresetEditOpen(true);
                                                                    }}
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                                                </button>
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                    <CommandSeparator />
                                                    <CommandGroup>
                                                        <CommandItem
                                                            value="__create__"
                                                            onSelect={() => {
                                                                setPresetOpen(false);
                                                                setPresetCreateOpen(true);
                                                            }}
                                                            className="font-medium"
                                                        >
                                                            <Plus className="mr-2 h-3.5 w-3.5" />
                                                            Create new preset...
                                                        </CommandItem>
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                ) : (
                                    <FormControl>
                                        <SchedulePicker value={field.value} onChange={field.onChange} />
                                    </FormControl>
                                )}
                                <FormMessage />
                            </FormItem>
                        )} />

                    </TabsContent>

                    {/* TAB 2: DESTINATIONS */}
                    <TabsContent value="destinations" className="space-y-4 pt-4">
                        <Card className="border-border">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">Destinations</CardTitle>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            append({ configId: "", retention: { ...defaultRetentionValue }, retentionPolicyId: DEFAULT_RETENTION_SENTINEL });
                                        }}
                                        disabled={usedDestIds.length >= destinations.length}
                                    >
                                        <Plus className="h-4 w-4 mr-1" />
                                        Add Destination
                                    </Button>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    Backups are uploaded sequentially to each destination. Configure retention per destination.
                                </p>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {fields.length === 0 && (
                                    <div className="bg-muted p-4 rounded-md text-sm text-muted-foreground text-center">
                                        No destinations configured. Add at least one destination.
                                    </div>
                                )}
                                {fields.length > 0 && (
                                    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-100">
                                        <div className="space-y-3 pr-3">
                                            {fields.map((field, index) => (
                                                <DestinationRow
                                                    key={field.id}
                                                    index={index}
                                                    form={form}
                                                    destinations={destinations}
                                                    usedDestIds={usedDestIds}
                                                    isExpanded={expandedDests.has(index)}
                                                    onToggleExpand={() => toggleExpanded(index)}
                                                    onRemove={() => {
                                                        remove(index);
                                                        setExpandedDests(prev => {
                                                            const next = new Set<number>();
                                                            prev.forEach(i => {
                                                                if (i < index) next.add(i);
                                                                else if (i > index) next.add(i - 1);
                                                            });
                                                            return next;
                                                        });
                                                    }}
                                                    canRemove={fields.length > 1}
                                                />
                                            ))}
                                        </div>
                                    </ScrollArea>
                                )}
                                {form.formState.errors.destinations?.root && (
                                    <p className="text-sm text-destructive">{form.formState.errors.destinations.root.message}</p>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* TAB 3: ADVANCED (Compression & Encryption) */}
                    <TabsContent value="advanced" className="space-y-4 pt-4">
                        <FormField control={form.control} name="namingTemplateId" render={({ field }) => (
                            <FormItem>
                                <FormLabel className="flex items-center gap-2">
                                    <FileText className="h-3 w-3" />
                                    Naming Template
                                </FormLabel>
                                <FormControl>
                                    <NamingTemplatePicker
                                        value={field.value || null}
                                        onChange={(id) => field.onChange(id || undefined)}
                                        allowNone
                                        placeholder="Use default template"
                                    />
                                </FormControl>
                                <FormDescription>
                                    Controls the backup file name format. Leave blank to use the system default.
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )} />
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
                                    <Select onValueChange={field.onChange} value={field.value} disabled={isNativeCompressionActive}>
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
                                    <FormDescription>
                                        {isNativeCompressionActive
                                            ? "Disabled - PostgreSQL native compression is active."
                                            : "Trade CPU for storage."}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>

                        {/* PostgreSQL native dump compression - only visible when a postgres source is selected */}
                        {isPgSource && (
                            <div className="rounded-md border p-4 space-y-4 bg-muted/30">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">PostgreSQL Native Compression</span>
                                    <Badge variant="outline" className="text-xs font-mono">pg_dump -Z</Badge>
                                    {pgMajorVersion && (
                                        <Badge variant="secondary" className="text-xs">PostgreSQL {pgMajorVersion}</Badge>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                                    pg_dump compresses internally using the custom format (-Fc). When a native algorithm is selected, the pipeline compression above is automatically disabled to prevent double compression.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                    <FormField control={form.control} name="pgCompressionAlgo" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Algorithm</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={(val) => {
                                                    field.onChange(val);
                                                    const constraints = PG_LEVEL_CONSTRAINTS[val];
                                                    if (constraints) {
                                                        form.setValue("pgCompressionLevel", constraints.default);
                                                    }
                                                }}
                                            >
                                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent>
                                                    <SelectItem value="LEGACY">Legacy (Gzip, level 6)</SelectItem>
                                                    <SelectItem value="NONE">None (no compression)</SelectItem>
                                                    <SelectItem value="GZIP">Gzip (all versions)</SelectItem>
                                                    <SelectItem
                                                        value="LZ4"
                                                        disabled={pgMajorVersion !== null && pgMajorVersion < 14}
                                                    >
                                                        LZ4{pgMajorVersion !== null && pgMajorVersion < 14 ? " (requires PostgreSQL 14+)" : " (PostgreSQL 14+)"}
                                                    </SelectItem>
                                                    <SelectItem
                                                        value="ZSTD"
                                                        disabled={pgMajorVersion !== null && pgMajorVersion < 16}
                                                    >
                                                        Zstd{pgMajorVersion !== null && pgMajorVersion < 16 ? " (requires PostgreSQL 16+)" : " (PostgreSQL 16+)"}
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormDescription>
                                                {pgCompressionAlgo === "LEGACY" && "Keeps original behavior: -Z 6."}
                                                {pgCompressionAlgo === "NONE" && "Passes -Z 0 to pg_dump (uncompressed)."}
                                                {pgCompressionAlgo === "GZIP" && "Gzip via -Z N. Works on all PostgreSQL versions."}
                                                {pgCompressionAlgo === "LZ4" && "Fast compression via -Z lz4:N. Requires PostgreSQL 14+."}
                                                {pgCompressionAlgo === "ZSTD" && "Best ratio via -Z zstd:N. Requires PostgreSQL 16+."}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )} />

                                    {pgCompressionAlgo && PG_LEVEL_CONSTRAINTS[pgCompressionAlgo] && (
                                        <FormField control={form.control} name="pgCompressionLevel" render={({ field }) => {
                                            const constraints = PG_LEVEL_CONSTRAINTS[pgCompressionAlgo]!;
                                            return (
                                                <FormItem>
                                                    <FormLabel>Level</FormLabel>
                                                    <Select
                                                        value={String(field.value)}
                                                        onValueChange={(val) => field.onChange(parseInt(val, 10))}
                                                    >
                                                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            {constraints.values.map((v) => (
                                                                <SelectItem key={v} value={String(v)}>
                                                                    {v}
                                                                    {v === constraints.default ? " (default)" : ""}
                                                                    {pgCompressionAlgo === "GZIP" && v === 0 ? " - store only" : ""}
                                                                    {pgCompressionAlgo === "GZIP" && v === 9 ? " - best ratio" : ""}
                                                                    {pgCompressionAlgo === "LZ4" && v === 0 ? " - fastest" : ""}
                                                                    {pgCompressionAlgo === "LZ4" && v === 9 ? " - best ratio" : ""}
                                                                    {pgCompressionAlgo === "ZSTD" && v === 1 ? " - fastest" : ""}
                                                                    {pgCompressionAlgo === "ZSTD" && v === 22 ? " - best ratio" : ""}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            );
                                        }} />
                                    )}
                                </div>
                            </div>
                        )}
                        <FormField control={form.control} name="skipVerification" render={({ field }) => (
                            <FormItem>
                                <div className="flex items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel>Skip Verification</FormLabel>
                                        <FormDescription>
                                            Exclude this job from scheduled integrity checks.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </div>
                                <FormMessage />
                            </FormItem>
                        )} />
                    </TabsContent>

                    {/* TAB 4: NOTIFICATIONS */}
                    <TabsContent value="notifications" className="pt-4 space-y-4">
                        <FormField control={form.control} name="notificationTemplateIds" render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <div className="border rounded-lg p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <FormLabel className="text-base">Notification Templates</FormLabel>
                                            <p className="text-sm text-muted-foreground mt-0.5">
                                                Backups send notifications to each template&apos;s configured channels.
                                            </p>
                                        </div>
                                    </div>

                                    {(field.value || []).length > 0 && (
                                        <div className="space-y-2">
                                            {(field.value || []).map((templateId: string, idx: number) => (
                                                <div key={templateId} className="flex items-center gap-2">
                                                    <span className="text-xs text-muted-foreground w-5 text-right shrink-0">#{idx + 1}</span>
                                                    <div className="flex-1">
                                                        <NotificationTemplatePicker
                                                            value={templateId}
                                                            onChange={(id) => {
                                                                if (!id) return;
                                                                const current = [...(field.value || [])];
                                                                current[idx] = id;
                                                                field.onChange(current);
                                                            }}
                                                            usedIds={(field.value || []).filter((_: string, i: number) => i !== idx)}
                                                        />
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-muted-foreground hover:text-destructive shrink-0"
                                                        onClick={() => {
                                                            field.onChange((field.value || []).filter((_: string, i: number) => i !== idx));
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <NotificationTemplatePicker
                                        value={null}
                                        onChange={(id) => {
                                            if (!id) return;
                                            const current = field.value || [];
                                            if (!current.includes(id)) {
                                                field.onChange([...current, id]);
                                            }
                                        }}
                                        placeholder="Add Notification Template"
                                        usedIds={field.value || []}
                                    />
                                </div>
                                <FormMessage />
                            </FormItem>
                        )} />
                    </TabsContent>
                </Tabs>

                <div className="pt-4 border-t">
                    <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Job Configuration
                    </Button>
                </div>
            </form>
        </Form>

        <SchedulePresetDialog
            open={presetCreateOpen}
            onOpenChange={setPresetCreateOpen}
            onSuccess={(preset) => {
                setSchedulePresets((prev) => [...prev, preset].sort((a, b) => a.name.localeCompare(b.name)));
                form.setValue("schedule", preset.schedule);
                setLinkedPresetId(preset.id);
                setLinkedPresetName(preset.name);
                setUseSchedulePreset(false);
                setPresetCreateOpen(false);
            }}
        />

        <SchedulePresetDialog
            open={presetEditOpen}
            onOpenChange={(v) => { setPresetEditOpen(v); if (!v) setPresetEditTarget(null); }}
            preset={presetEditTarget ?? undefined}
            onSuccess={(preset) => {
                setSchedulePresets((prev) => prev.map((p) => p.id === preset.id ? preset : p));
                if (linkedPresetId === preset.id) {
                    setLinkedPresetName(preset.name);
                    form.setValue("schedule", preset.schedule);
                }
                setPresetEditTarget(null);
                setPresetEditOpen(false);
            }}
        />
        </>
    )
}

// --- Destination Row Component ---

interface DestinationRowProps {
    index: number;
    form: any;
    destinations: AdapterOption[];
    usedDestIds: string[];
    isExpanded: boolean;
    onToggleExpand: () => void;
    onRemove: () => void;
    canRemove: boolean;
}

function DestinationRow({ index, form, destinations, usedDestIds, isExpanded, onToggleExpand, onRemove, canRemove }: DestinationRowProps) {
    const [destOpen, setDestOpen] = useState(false);
    const currentConfigId = form.watch(`destinations.${index}.configId`);
    const currentDest = destinations.find(d => d.id === currentConfigId);

    // Available destinations: not yet used by other rows OR is the current row's selection
    const availableDests = destinations.filter(d => !usedDestIds.includes(d.id) || d.id === currentConfigId);

    return (
        <div className="border rounded-lg">
            <div className="flex items-center gap-2 p-3">
                <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">#{index + 1}</span>

                <FormField control={form.control} name={`destinations.${index}.configId`} render={({ field }) => (
                    <FormItem className="flex-1 space-y-0">
                        <Popover open={destOpen} onOpenChange={setDestOpen} modal={true}>
                            <PopoverTrigger asChild>
                                <FormControl>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        aria-expanded={destOpen}
                                        className={cn("w-full justify-between h-9", !field.value && "text-muted-foreground")}
                                    >
                                        {currentDest ? (
                                            <span className="flex items-center gap-2 min-w-0">
                                                <AdapterIcon adapterId={currentDest.adapterId} className="h-4 w-4 shrink-0" />
                                                <span className="truncate">{currentDest.name}</span>
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
                                            {availableDests.map((d) => (
                                                <CommandItem
                                                    value={d.name}
                                                    key={d.id}
                                                    onSelect={() => {
                                                        form.setValue(`destinations.${index}.configId`, d.id);
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

                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2"
                    onClick={onToggleExpand}
                    title="Retention settings"
                >
                    <History className="h-4 w-4 mr-1" />
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </Button>

                {canRemove && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 px-2 text-muted-foreground hover:text-destructive"
                        onClick={onRemove}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Inline Retention Config */}
            <Collapsible open={isExpanded}>
                <CollapsibleContent>
                    <div className="border-t px-3 py-3 bg-muted/30 space-y-2">
                        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <History className="h-3 w-3" />
                            Retention for {currentDest?.name || `Destination #${index + 1}`}
                        </div>
                        <RetentionPolicyPicker
                            value={form.watch(`destinations.${index}.retentionPolicyId`) ?? null}
                            onChange={(id) => form.setValue(`destinations.${index}.retentionPolicyId`, id ?? undefined, { shouldValidate: true })}
                            allowDefault
                            placeholder="No policy (keep all)"
                        />
                        <p className="text-xs text-muted-foreground">
                            Select a retention policy to automatically clean up old backups at this destination.
                        </p>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

// --- Retention Config Component (reusable per destination) ---

function _RetentionConfig({ form, prefix }: { form: any; prefix: string }) {
    const mode = form.watch(`${prefix}.mode`);

    return (
        <div className="space-y-3">
            <FormField
                control={form.control}
                name={`${prefix}.mode`}
                render={({ field }) => (
                    <Tabs value={field.value} onValueChange={field.onChange} className="w-full">
                        <TabsList className="grid w-full grid-cols-3 h-8">
                            <TabsTrigger value="NONE" className="text-xs">Keep All</TabsTrigger>
                            <TabsTrigger value="SIMPLE" className="text-xs">Simple</TabsTrigger>
                            <TabsTrigger value="SMART" className="text-xs">Smart (GFS)</TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
            />

            {mode === "NONE" && (
                <p className="text-xs text-muted-foreground">All backups kept indefinitely.</p>
            )}

            {mode === "SIMPLE" && (
                <FormField
                    control={form.control}
                    name={`${prefix}.simple.keepCount`}
                    render={({ field }) => (
                        <FormItem>
                            <div className="flex items-center gap-2">
                                <FormControl>
                                    <Input type="number" min={1} {...field} value={field.value as number} onChange={e => field.onChange(parseInt(e.target.value))} className="w-20 h-8" />
                                </FormControl>
                                <span className="text-xs text-muted-foreground">newest backups</span>
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}

            {mode === "SMART" && (
                <div className="grid grid-cols-4 gap-2">
                    {(["daily", "weekly", "monthly", "yearly"] as const).map(period => (
                        <FormField
                            key={period}
                            control={form.control}
                            name={`${prefix}.smart.${period}`}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs capitalize">{period}</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            min={0}
                                            {...field}
                                            value={field.value as number}
                                            onChange={e => field.onChange(parseInt(e.target.value))}
                                            className="h-8"
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
