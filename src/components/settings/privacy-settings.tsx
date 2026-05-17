"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ShieldOff } from "lucide-react";
import { updatePrivacySettings } from "@/app/actions/settings/privacy-settings";

interface PrivacySettingsProps {
    initialIncludeActorInMetadata: boolean;
}

export function PrivacySettings({ initialIncludeActorInMetadata }: PrivacySettingsProps) {
    const [includeActor, setIncludeActor] = useState(initialIncludeActorInMetadata);

    async function handleToggle(checked: boolean) {
        setIncludeActor(checked);
        toast.promise(updatePrivacySettings({ includeActorInMetadata: checked }), {
            loading: "Saving...",
            success: (result) => {
                if (result.success) return "Privacy settings saved.";
                throw new Error(result.error);
            },
            error: (err) => `Failed to save: ${err.message || "Unknown error"}`,
        });
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldOff className="h-5 w-5" />
                    Backup Metadata
                </CardTitle>
                <CardDescription>
                    Control what information is stored in backup metadata files (.meta.json). These files are not encrypted and are stored alongside backups on the configured storage destinations.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                        <Label htmlFor="includeActor">Store trigger actor in metadata</Label>
                        <p className="text-sm text-muted-foreground">
                            When enabled, the username or API key name that triggered a backup is stored in the metadata file. Disable this if you do not want user or key names written to unencrypted storage destinations.
                        </p>
                    </div>
                    <Switch
                        id="includeActor"
                        checked={includeActor}
                        onCheckedChange={handleToggle}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
