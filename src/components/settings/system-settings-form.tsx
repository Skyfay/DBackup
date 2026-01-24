"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
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
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Shield, Cpu } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const formSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
    disablePasskeyLogin: z.boolean().default(false),
    auditLogRetentionDays: z.coerce.number().min(1).max(365).default(90),
})

interface SystemSettingsFormProps {
    initialMaxConcurrentJobs: number;
    initialDisablePasskeyLogin?: boolean;
    initialAuditLogRetentionDays?: number;
}

export function SystemSettingsForm({ initialMaxConcurrentJobs, initialDisablePasskeyLogin, initialAuditLogRetentionDays = 90 }: SystemSettingsFormProps) {
    const [isPending, setIsPending] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            maxConcurrentJobs: initialMaxConcurrentJobs,
            disablePasskeyLogin: initialDisablePasskeyLogin === true,
            auditLogRetentionDays: initialAuditLogRetentionDays,
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
                    <CardContent>
                        <FormField
                            control={form.control}
                            name="maxConcurrentJobs"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Max Concurrent Jobs</FormLabel>
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
                                    <FormDescription>
                                        The maximum number of backup jobs that can run simultaneously.
                                        Jobs will be queued if this limit is reached.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="auditLogRetentionDays"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Audit Log Retention</FormLabel>
                                    <Select
                                        onValueChange={(val) => handleAutoSave("auditLogRetentionDays", Number(val))}
                                        defaultValue={String(field.value)}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select retention period" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="30">30 Days</SelectItem>
                                            <SelectItem value="60">60 Days</SelectItem>
                                            <SelectItem value="90">90 Days (Default)</SelectItem>
                                            <SelectItem value="180">180 Days</SelectItem>
                                            <SelectItem value="365">1 Year</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>
                                        Automatically delete audit logs older than the specified period.
                                        This runs daily as part of the "Clean Old Logs" system task.
                                    </FormDescription>
                                    <FormMessage />
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
                                        <FormLabel className="text-base">Disable "Sign in with Passkey"</FormLabel>
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
