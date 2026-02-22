"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useWatch } from "react-hook-form"
import * as z from "zod"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import { updateSystemSettings } from "@/app/actions/settings"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, Cpu, Rocket, Database, ScrollText, HardDrive, Bell } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

const formSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
    disablePasskeyLogin: z.boolean().default(false),
    auditLogRetentionDays: z.coerce.number().min(1).max(1825).default(90),
    storageSnapshotRetentionDays: z.coerce.number().min(7).max(1825).default(90),
    notificationLogRetentionDays: z.coerce.number().min(7).max(1825).default(90),
    checkForUpdates: z.boolean().default(true),
    showQuickSetup: z.boolean().default(false),
})

interface SystemSettingsFormProps {
    initialMaxConcurrentJobs: number;
    initialDisablePasskeyLogin?: boolean;
    initialAuditLogRetentionDays?: number;
    initialStorageSnapshotRetentionDays?: number;
    initialNotificationLogRetentionDays?: number;
    initialCheckForUpdates?: boolean;
    initialShowQuickSetup?: boolean;
}

export function SystemSettingsForm({ initialMaxConcurrentJobs, initialDisablePasskeyLogin, initialAuditLogRetentionDays = 90, initialStorageSnapshotRetentionDays = 90, initialNotificationLogRetentionDays = 90, initialCheckForUpdates = true, initialShowQuickSetup = false }: SystemSettingsFormProps) {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            maxConcurrentJobs: initialMaxConcurrentJobs,
            disablePasskeyLogin: initialDisablePasskeyLogin === true,
            auditLogRetentionDays: initialAuditLogRetentionDays,
            storageSnapshotRetentionDays: initialStorageSnapshotRetentionDays,
            notificationLogRetentionDays: initialNotificationLogRetentionDays,
            checkForUpdates: initialCheckForUpdates === true,
            showQuickSetup: initialShowQuickSetup === true,
        },
    })

    const handleAutoSave = async (field: keyof z.infer<typeof formSchema>, value: any) => {
        // Update local state immediately
        form.setValue(field, value);

        // Prepare full data object for server action
        const currentValues = form.getValues();
        const dataToSave = { ...currentValues, [field]: value };

        toast.promise(updateSystemSettings(dataToSave), {
            loading: 'Saving settings...',
            success: (result) => {
                if (result.success) {
                    return "Settings saved";
                } else {
                    throw new Error(result.error);
                }
            },
            error: (err) => `Failed to save: ${err.message || 'Unknown error'}`
        });
    };

    const formatRetention = (days: number) => {
        if (days >= 365 && days % 365 === 0) return `${days / 365}y`;
        return `${days}d`;
    };

    const auditLogRetentionDays = useWatch({ control: form.control, name: "auditLogRetentionDays" });
    const storageSnapshotRetentionDays = useWatch({ control: form.control, name: "storageSnapshotRetentionDays" });
    const notificationLogRetentionDays = useWatch({ control: form.control, name: "notificationLogRetentionDays" });

    return (
        <Form {...form}>
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Cpu className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>Job Execution</CardTitle>
                        </div>
                        <CardDescription>
                            Configure how jobs are executed on the server.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <FormField
                            control={form.control}
                            name="maxConcurrentJobs"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Max Concurrent Jobs</FormLabel>
                                    <FormDescription>
                                        The maximum number of backup jobs that can run simultaneously.
                                        Jobs will be queued if this limit is reached.
                                    </FormDescription>
                                    <Select
                                        onValueChange={(val) => handleAutoSave("maxConcurrentJobs", Number(val))}
                                        defaultValue={String(field.value)}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select limit" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                                                <SelectItem key={num} value={String(num)}>
                                                    {num} Job{num > 1 ? "s" : ""}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div>
                            <FormLabel>Data Retention</FormLabel>
                            <FormDescription>
                                Automatically delete old data beyond the configured retention periods.
                                Runs daily as part of the &quot;Clean Old Data&quot; system task.
                            </FormDescription>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="mt-2 w-full justify-between">
                                        <div className="flex items-center gap-2">
                                            <Database className="h-4 w-4 text-muted-foreground" />
                                            <span>Configure Retention Policies</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {formatRetention(auditLogRetentionDays)} / {formatRetention(storageSnapshotRetentionDays)} / {formatRetention(notificationLogRetentionDays)}
                                        </span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80" align="start">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <h4 className="font-medium text-sm leading-none">Retention Policies</h4>
                                            <p className="text-xs text-muted-foreground">
                                                Set how long each data type is kept before automatic cleanup.
                                            </p>
                                        </div>

                                        <FormField
                                            control={form.control}
                                            name="auditLogRetentionDays"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center gap-2">
                                                        <ScrollText className="h-4 w-4 text-muted-foreground shrink-0" />
                                                        <FormLabel className="text-sm">Audit Logs</FormLabel>
                                                    </div>
                                                    <Select
                                                        onValueChange={(val) => handleAutoSave("auditLogRetentionDays", Number(val))}
                                                        defaultValue={String(field.value)}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-8">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="30">30 Days</SelectItem>
                                                            <SelectItem value="60">60 Days</SelectItem>
                                                            <SelectItem value="90">90 Days (Default)</SelectItem>
                                                            <SelectItem value="180">180 Days</SelectItem>
                                                            <SelectItem value="365">1 Year</SelectItem>
                                                            <SelectItem value="730">2 Years</SelectItem>
                                                            <SelectItem value="1095">3 Years</SelectItem>
                                                            <SelectItem value="1825">5 Years</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="storageSnapshotRetentionDays"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center gap-2">
                                                        <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                                                        <FormLabel className="text-sm">Storage Snapshots</FormLabel>
                                                    </div>
                                                    <Select
                                                        onValueChange={(val) => handleAutoSave("storageSnapshotRetentionDays", Number(val))}
                                                        defaultValue={String(field.value)}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-8">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="7">7 Days</SelectItem>
                                                            <SelectItem value="14">14 Days</SelectItem>
                                                            <SelectItem value="30">30 Days</SelectItem>
                                                            <SelectItem value="60">60 Days</SelectItem>
                                                            <SelectItem value="90">90 Days (Default)</SelectItem>
                                                            <SelectItem value="180">180 Days</SelectItem>
                                                            <SelectItem value="365">1 Year</SelectItem>
                                                            <SelectItem value="730">2 Years</SelectItem>
                                                            <SelectItem value="1095">3 Years</SelectItem>
                                                            <SelectItem value="1825">5 Years</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="notificationLogRetentionDays"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center gap-2">
                                                        <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
                                                        <FormLabel className="text-sm">Notification Logs</FormLabel>
                                                    </div>
                                                    <Select
                                                        onValueChange={(val) => handleAutoSave("notificationLogRetentionDays", Number(val))}
                                                        defaultValue={String(field.value)}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-8">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="7">7 Days</SelectItem>
                                                            <SelectItem value="14">14 Days</SelectItem>
                                                            <SelectItem value="30">30 Days</SelectItem>
                                                            <SelectItem value="60">60 Days</SelectItem>
                                                            <SelectItem value="90">90 Days (Default)</SelectItem>
                                                            <SelectItem value="180">180 Days</SelectItem>
                                                            <SelectItem value="365">1 Year</SelectItem>
                                                            <SelectItem value="730">2 Years</SelectItem>
                                                            <SelectItem value="1095">3 Years</SelectItem>
                                                            <SelectItem value="1825">5 Years</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>

                        <FormField
                            control={form.control}
                            name="checkForUpdates"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-base">Check for Updates</FormLabel>
                                        <FormDescription>
                                            Automatically check for new versions of the application.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={(val) => handleAutoSave("checkForUpdates", val)}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Rocket className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>Quick Setup Wizard</CardTitle>
                        </div>
                        <CardDescription>
                            Control visibility of the Quick Setup wizard in the sidebar.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FormField
                            control={form.control}
                            name="showQuickSetup"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-base">Always Show Quick Setup</FormLabel>
                                        <FormDescription>
                                            The Quick Setup wizard is automatically shown when no database sources exist.
                                            Enable this to always show it in the sidebar.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={(val) => handleAutoSave("showQuickSetup", val)}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>Authentication & Security</CardTitle>
                        </div>
                        <CardDescription>
                            Configure login and security settings.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FormField
                            control={form.control}
                            name="disablePasskeyLogin"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-base">Disable &quot;Sign in with Passkey&quot;</FormLabel>
                                        <FormDescription>
                                            Hide the passkey login button on the login screen. Does not disable passkey 2FA.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={(val) => handleAutoSave("disablePasskeyLogin", val)}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </CardContent>
                </Card>
            </div>
        </Form>
    )
}
