"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
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
import { updateConfigBackupSettings } from "@/app/actions/config-backup-settings"
import { exportConfigAction, importConfigAction } from "@/app/actions/config-management"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Save, Download, Upload, ShieldCheck, Database, FileCog } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const formSchema = z.object({
    enabled: z.boolean(),
    schedule: z.string().min(1, "Schedule is required"),
    storageId: z.string().min(1, "Destination is required"),
    profileId: z.string().optional(),
    includeSecrets: z.boolean(),
    retention: z.coerce.number().min(1).default(10),
})

interface ConfigBackupSettingsProps {
    initialSettings: {
        enabled: boolean;
        schedule: string;
        storageId: string;
        profileId: string;
        includeSecrets: boolean;
        retention: number;
    };
    storageAdapters: { id: string, name: string }[];
    encryptionProfiles: { id: string, name: string }[];
}

export function ConfigBackupSettings({ initialSettings, storageAdapters, encryptionProfiles }: ConfigBackupSettingsProps) {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            enabled: initialSettings.enabled,
            schedule: initialSettings.schedule,
            storageId: initialSettings.storageId,
            profileId: initialSettings.profileId || "NO_ENCRYPTION",
            includeSecrets: initialSettings.includeSecrets,
            retention: initialSettings.retention,
        },
    })

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        const submission = {
            ...values,
            profileId: values.profileId === "NO_ENCRYPTION" ? "" : values.profileId
        };
        const result = await updateConfigBackupSettings(submission);
        if (result.success) {
            toast.success("Configuration backup settings updated");
        } else {
            toast.error(result.error || "Failed to update settings");
        }
    }

    const includeSecrets = form.watch("includeSecrets");
    const profileId = form.watch("profileId");

    const handleExport = async (e: React.MouseEvent) => {
        e.preventDefault();
        const withSecrets = form.getValues("includeSecrets");

        toast.promise(async () => {
             const result = await exportConfigAction(withSecrets);
             if (!result.success || !result.data) throw new Error(result.error);
             return result.data;
        }, {
            loading: 'Exporting configuration...',
            success: (data) => {
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `backup-manager-config-${new Date().toISOString()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return "Configuration exported successfully";
            },
            error: (err) => `Export failed: ${err instanceof Error ? err.message : String(err)}`
        });
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        toast.promise(async () => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const data = JSON.parse(ev.target?.result as string);
                        const result = await importConfigAction(data);
                        if (result.success) resolve("Configuration imported");
                        else reject(new Error(result.error));
                    } catch {
                        reject(new Error("Invalid JSON file"));
                    }
                };
                reader.onerror = () => reject(new Error("Failed to read file"));
                reader.readAsText(file);
            });
        }, {
            loading: 'Importing configuration...',
            success: 'Configuration imported successfully',
            error: (err) => `Import failed: ${err.message}`
        });

        // Reset input
        e.target.value = "";
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <FileCog className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>Automated Configuration Backup</CardTitle>
                        </div>
                        <CardDescription>
                            Automatically backup your system configuration (adapters, jobs, users, settings) to a remote storage.
                            This allows for full disaster recovery without a database snapshot.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <FormField
                            control={form.control}
                            name="enabled"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-base">Enable Automated Backups</FormLabel>
                                        <FormDescription>
                                            Running on the defined schedule.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField
                                control={form.control}
                                name="storageId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Destination Storage</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select storage" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {storageAdapters.map((adapter) => (
                                                    <SelectItem key={adapter.id} value={adapter.id}>
                                                        {adapter.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="schedule"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Schedule (Cron)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="0 3 * * *" {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            Example: &quot;0 3 * * *&quot; (Every day at 3 AM UTC)
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField
                                control={form.control}
                                name="profileId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Encryption Profile (Vault)</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select encryption profile" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {encryptionProfiles.length > 0 ? (
                                                     encryptionProfiles.map((p) => (
                                                        <SelectItem key={p.id} value={p.id}>
                                                            {p.name}
                                                        </SelectItem>
                                                    ))
                                                ) : (
                                                    <SelectItem value="none" disabled>No profiles created</SelectItem>
                                                )}
                                                <SelectItem value="NO_ENCRYPTION">No Encryption (Not Recommended)</SelectItem>

                                            </SelectContent>
                                        </Select>
                                        <FormDescription>
                                           Encrypts the resulting JSON file. Crucial if secrets are included.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="retention"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Retention Count</FormLabel>
                                        <FormControl>
                                            <Input type="number" min={1} {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            Number of backup files to keep. Older files will be deleted.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>


                        <FormField
                            control={form.control}
                            name="includeSecrets"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-base">Include Credentials & Secrets</FormLabel>
                                        <FormDescription>
                                            Includes database passwords and API keys in the export.
                                            Requires an Encryption Profile to be selected.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                         {includeSecrets && (!profileId || profileId === "NO_ENCRYPTION") && (
                            <Alert variant="destructive">
                                <ShieldCheck className="h-4 w-4" />
                                <AlertTitle>Security Warning</AlertTitle>
                                <AlertDescription>
                                    You have enabled &quot;Include Secrets&quot; but have not selected an Encryption Profile.
                                    You cannot save this configuration until you select a Vault profile to encrypt the sensitive data.
                                </AlertDescription>
                            </Alert>
                        )}

                    </CardContent>
                    <CardFooter>
                        <Button type="submit" disabled={includeSecrets && (!profileId || profileId === "NO_ENCRYPTION")}>
                            <Save className="w-4 h-4 mr-2" />
                            Save Configuration
                        </Button>
                    </CardFooter>
                </Card>
            </form>

            <Card>
                 <CardHeader>
                    <div className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-muted-foreground" />
                        <CardTitle>Manual Actions</CardTitle>
                    </div>
                    <CardDescription>Export current configuration to a JSON file or import a configuration backup.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4">
                        <Button variant="outline" size="sm" onClick={handleExport}>
                            <Download className="w-4 h-4 mr-2" />
                            Export Configuration Now
                        </Button>
                         <div className="relative">
                            <Button variant="outline" size="sm" onClick={() => document.getElementById("import-config-file")?.click()}>
                                <Upload className="w-4 h-4 mr-2" />
                                Import Configuration...
                            </Button>
                            <input
                                id="import-config-file"
                                type="file"
                                accept=".json"
                                className="hidden"
                                onChange={handleImport}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Form>
    )
}
