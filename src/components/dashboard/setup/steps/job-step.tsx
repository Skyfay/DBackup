"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    ArrowLeft,
    CalendarClock,
    CheckCircle2,
    Database,
    Lock,
    ArrowRight,
} from "lucide-react";
import { DatabasePicker } from "@/components/adapter/database-picker";
import { WizardData } from "../setup-wizard";

const SCHEDULE_PRESETS = [
    { label: "Every hour", value: "0 * * * *" },
    { label: "Every 6 hours", value: "0 */6 * * *" },
    { label: "Every 12 hours", value: "0 */12 * * *" },
    { label: "Daily at midnight", value: "0 0 * * *" },
    { label: "Daily at 3 AM", value: "0 3 * * *" },
    { label: "Weekly (Sunday midnight)", value: "0 0 * * 0" },
    { label: "Monthly (1st at midnight)", value: "0 0 1 * *" },
];

const jobSchema = z.object({
    name: z.string().min(1, "Job name is required"),
    schedule: z.string().min(1, "Schedule is required"),
    databases: z.array(z.string()),
    compression: z.enum(["NONE", "GZIP", "BROTLI"]),
    enabled: z.boolean(),
    notificationEvents: z.enum(["ALWAYS", "FAILURE_ONLY", "SUCCESS_ONLY"]),
});

type JobFormValues = z.infer<typeof jobSchema>;

interface JobStepProps {
    wizardData: WizardData;
    onUpdate: (data: Partial<WizardData>) => void;
    onNext: () => void;
    onPrev: () => void;
}

export function JobStep({ wizardData, onUpdate, onNext, onPrev }: JobStepProps) {
    const [isSaved, setIsSaved] = useState(!!wizardData.jobId);
    const [selectedPreset, setSelectedPreset] = useState("0 0 * * *");
    const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
    const [isLoadingDbs, setIsLoadingDbs] = useState(false);
    const [isDbListOpen, setIsDbListOpen] = useState(false);

    const showDatabasePicker = wizardData.sourceAdapterId
        && !["sqlite", "redis", "valkey"].includes(wizardData.sourceAdapterId);

    const fetchDatabases = useCallback(async () => {
        if (!wizardData.sourceId) return;
        setIsLoadingDbs(true);
        try {
            const res = await fetch(`/api/adapters/${encodeURIComponent(wizardData.sourceId)}/databases`);
            const data = await res.json();
            if (data.success && Array.isArray(data.databases)) {
                setAvailableDatabases(data.databases);
            }
        } finally {
            setIsLoadingDbs(false);
        }
    }, [wizardData.sourceId]);

    const form = useForm<JobFormValues>({
        resolver: zodResolver(jobSchema),
        defaultValues: {
            name: "",
            schedule: "0 0 * * *",
            databases: [],
            compression: "GZIP",
            enabled: true,
            notificationEvents: "ALWAYS",
        },
    });

    const onSubmit = async (data: JobFormValues) => {
        try {
            const payload = {
                name: data.name,
                schedule: data.schedule,
                sourceId: wizardData.sourceId,
                databases: data.databases,
                destinations: [{
                    configId: wizardData.destinationId,
                    priority: 0,
                    retention: {
                        mode: "SIMPLE",
                        simple: { keepCount: 10 },
                    },
                }],
                encryptionProfileId: wizardData.encryptionProfileId || "",
                compression: data.compression,
                enabled: data.enabled,
                notificationIds: wizardData.notificationIds,
                notificationEvents: data.notificationEvents,
            };

            const res = await fetch("/api/jobs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                const result = await res.json();
                toast.success("Backup job created successfully");
                onUpdate({
                    jobId: result.id,
                    jobName: data.name,
                });
                setIsSaved(true);
                // Auto-advance to completion
                onNext();
            } else {
                const errResult = await res.json().catch(() => null);
                toast.error(errResult?.error || "Failed to create job");
            }
        } catch {
            toast.error("An error occurred while creating the job");
        }
    };

    // Already saved
    if (isSaved) {
        return (
            <div className="space-y-6">
                <div className="text-center space-y-4 py-8">
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                    <h3 className="text-xl font-semibold">Backup Job Created</h3>
                    <p className="text-muted-foreground">
                        <strong>{wizardData.jobName}</strong> is ready to run.
                    </p>
                </div>
                <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={onPrev}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                    </Button>
                    <Button onClick={onNext}>
                        Continue
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <CalendarClock className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">Create Backup Job</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                    Configure when and how your backups should run. This job connects your source,
                    destination{wizardData.encryptionProfileId ? ", encryption" : ""}{" "}
                    {wizardData.notificationIds.length > 0 ? "and notifications" : ""} together.
                </p>
            </div>

            {/* Summary of what was configured */}
            <Card className="border-dashed">
                <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground">Source:</span>
                            <p className="font-medium">{wizardData.sourceName}</p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Destination:</span>
                            <p className="font-medium">{wizardData.destinationName}</p>
                        </div>
                        {wizardData.encryptionProfileName && (
                            <div>
                                <span className="text-muted-foreground flex items-center gap-1">
                                    <Lock className="h-3 w-3" />
                                    Encryption:
                                </span>
                                <p className="font-medium">{wizardData.encryptionProfileName}</p>
                            </div>
                        )}
                        {wizardData.notificationNames.length > 0 && (
                            <div>
                                <span className="text-muted-foreground">Notifications:</span>
                                <p className="font-medium">{wizardData.notificationNames.join(", ")}</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Job Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Daily Production Backup" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* Database Selection */}
                    {showDatabasePicker && (
                        <FormField
                            control={form.control}
                            name="databases"
                            render={({ field }) => (
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
                            )}
                        />
                    )}

                    {/* Schedule */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <CalendarClock className="h-4 w-4" />
                                Schedule
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Quick Presets</label>
                                <div className="flex flex-wrap gap-2">
                                    {SCHEDULE_PRESETS.map((preset) => (
                                        <Button
                                            key={preset.value}
                                            type="button"
                                            variant={selectedPreset === preset.value ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => {
                                                setSelectedPreset(preset.value);
                                                form.setValue("schedule", preset.value);
                                            }}
                                        >
                                            {preset.label}
                                        </Button>
                                    ))}
                                </div>
                            </div>

                            <FormField
                                control={form.control}
                                name="schedule"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Cron Expression</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="0 0 * * *"
                                                {...field}
                                                onChange={(e) => {
                                                    field.onChange(e);
                                                    setSelectedPreset(e.target.value);
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Format: Minute Hour Day Month Weekday
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="enabled"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3 py-2">
                                            <span className="text-sm">
                                                {field.value ? "Job will start immediately on schedule" : "Job is paused, run manually when ready"}
                                            </span>
                                            <FormControl>
                                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                                            </FormControl>
                                        </div>
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                    </Card>

                    {/* Compression & Notifications */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="compression"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Compression</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="NONE">None (Fastest)</SelectItem>
                                            <SelectItem value="GZIP">Gzip (Recommended)</SelectItem>
                                            <SelectItem value="BROTLI">Brotli (Best Compression)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>Trade CPU for storage space.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {wizardData.notificationIds.length > 0 && (
                            <FormField
                                control={form.control}
                                name="notificationEvents"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Notification Trigger</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="ALWAYS">Always (Success & Failure)</SelectItem>
                                                <SelectItem value="FAILURE_ONLY">On Failure Only</SelectItem>
                                                <SelectItem value="SUCCESS_ONLY">On Success Only</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>When should alerts be sent?</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-between pt-4">
                        <Button type="button" variant="outline" onClick={onPrev}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back
                        </Button>
                        <Button type="submit">
                            Create Job & Finish
                            <CheckCircle2 className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}
