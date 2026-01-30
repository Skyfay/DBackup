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
import { uploadAndRestoreConfigAction } from "@/app/actions/config-management"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Upload, ShieldCheck, Database, FileCog, LockKeyhole } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useState } from "react"


const formSchema = z.object({
    enabled: z.boolean(),
    // schedule: z.string().min(1, "Schedule is required"), // REMOVED
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
            // schedule: initialSettings.schedule,
            storageId: initialSettings.storageId,
            profileId: initialSettings.profileId || "NO_ENCRYPTION",
            includeSecrets: initialSettings.includeSecrets,
            retention: initialSettings.retention,
        },
    })

    const handleAutoSave = async (field: keyof z.infer<typeof formSchema>, value: any) => {
        // Update local form state
        form.setValue(field, value);

        // Get full current values, merged with the new change
        const currentValues = form.getValues();
        const updatedValues = { ...currentValues, [field]: value };

        const submission = {
            ...updatedValues,
            profileId: updatedValues.profileId === "NO_ENCRYPTION" ? "" : updatedValues.profileId
        };

        // Optimistic UI updates are handled by react-hook-form local state
        // We just fire the save request
        toast.promise(updateConfigBackupSettings(submission), {
            loading: 'Saving settings...',
            success: (res) => {
                if(res.success) return "Settings saved";
                throw new Error(res.error);
            },
            error: (err) => `Failed to save: ${err.message}`
        });
    };

    const includeSecrets = form.watch("includeSecrets");
    const profileId = form.watch("profileId");

    const [isRestoreOpen, setIsRestoreOpen] = useState(false);

    const handleOfflineRestore = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);

        setIsRestoreOpen(false);

        toast.promise(uploadAndRestoreConfigAction(formData), {
             loading: 'Uploading and Restoring...',
             success: (res) => {
                 if (!res.success) throw new Error(res.error);
                 return "Configuration Restored & Applied Successfully";
             },
             error: (err) => `Restore Failed: ${err.message}`
        });
    }

    return (
        <Form {...form}>
            <div className="space-y-6">
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
                                            onCheckedChange={(val) => handleAutoSave("enabled", val)}
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
                                        <Select
                                            onValueChange={(val) => handleAutoSave("storageId", val)}
                                            defaultValue={field.value}
                                        >
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

                            <div className="space-y-2">
                                <FormLabel>Schedule</FormLabel>
                                <div className="text-sm text-muted-foreground p-3 border rounded-md bg-muted/50">
                                    Managed in <b>System Tasks</b>.
                                    <br/>
                                    Look for: <b>Automated Configuration Backup</b>
                                </div>
                            </div>
                        </div>

                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField
                                control={form.control}
                                name="profileId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Encryption Profile (Vault)</FormLabel>
                                        <Select
                                            onValueChange={(val) => handleAutoSave("profileId", val)}
                                            defaultValue={field.value}
                                        >
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
                                            <Input
                                                type="number"
                                                min={1}
                                                {...field}
                                                onChange={field.onChange} // Keep local state update
                                                onBlur={(e) => handleAutoSave("retention", Number(e.target.value))}
                                            />
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
                                            onCheckedChange={(val) => handleAutoSave("includeSecrets", val)}
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
                                    Settings cannot be saved until you select a Vault profile to encrypt the sensitive data.
                                </AlertDescription>
                            </Alert>
                        )}

                    </CardContent>
                </Card>

            <Card>
                 <CardHeader>
                    <div className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-muted-foreground" />
                        <CardTitle>Manual Operations</CardTitle>
                    </div>
                    <CardDescription>
                        Perform a disaster recovery restore using an existing backup file.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-6">

                         <div className="">
                            <h4 className="text-sm font-medium mb-2">Disaster Recovery (Offline Restore)</h4>
                            <p className="text-sm text-muted-foreground mb-4">
                                If you are starting fresh, you can upload a config backup file manually from your local device.
                                <br />
                                <span className="text-xs opacity-75">
                                    Note: For selective restoration (e.g. only restoring Settings or Users),
                                    please use the <b>Storage Explorer</b> instead.
                                </span>
                            </p>

                            <Dialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="w-full md:w-auto">
                                        <Upload className="w-4 h-4 mr-2" />
                                        Upload & Restore...
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Offline Configuration Restore</DialogTitle>
                                        <DialogDescription>
                                            Upload a configuration backup file to restore system settings.
                                            This action will <strong>overwrite</strong> current configurations.
                                        </DialogDescription>
                                    </DialogHeader>

                                    <form onSubmit={handleOfflineRestore} className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="backupFile">Backup File</Label>
                                            <Input id="backupFile" name="backupFile" type="file" required accept=".json,.gz,.enc,.br" />
                                            <p className="text-xs text-muted-foreground">The main backup file (e.g. <code>config_backup_...json.gz.enc</code>)</p>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="metaFile">Metadata File (Required for Encrypted Backups)</Label>
                                            <Input id="metaFile" name="metaFile" type="file" accept=".json" />
                                            <p className="text-xs text-muted-foreground">The sidecar metadata file (e.g. <code>...meta.json</code>). Contains encryption IV and AuthTag.</p>
                                        </div>

                                        <Alert variant="default" className="bg-muted">
                                            <LockKeyhole className="h-4 w-4" />
                                            <AlertTitle>Encryption Profile Required (if encrypted)</AlertTitle>
                                            <AlertDescription>
                                                The system will attempt to unlock the file using the Encryption Profile ID specified in the metadata.
                                                <br/>
                                                Ensure the relevant Encryption Profile exists in this system before restoring.
                                            </AlertDescription>
                                        </Alert>

                                        <DialogFooter>
                                            <Button type="button" variant="outline" onClick={() => setIsRestoreOpen(false)}>Cancel</Button>
                                            <Button type="submit" variant="destructive">
                                                Restore & Overwrite
                                            </Button>
                                        </DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>
                </CardContent>
            </Card>
           </div>
        </Form>
    )
}
