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
import { Loader2, Shield } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const formSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
    disablePasskeyLogin: z.boolean().default(false),
})

interface SystemSettingsFormProps {
    initialMaxConcurrentJobs: number;
    initialDisablePasskeyLogin?: boolean;
}

export function SystemSettingsForm({ initialMaxConcurrentJobs, initialDisablePasskeyLogin }: SystemSettingsFormProps) {
    const [isPending, setIsPending] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            maxConcurrentJobs: initialMaxConcurrentJobs,
            disablePasskeyLogin: initialDisablePasskeyLogin === true,
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
                        <CardTitle>Job Execution</CardTitle>
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
