"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { updateUserPreferences } from "@/app/actions/user"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

interface PreferencesFormProps {
    userId: string;
    autoRedirectOnJobStart: boolean;
}

export function PreferencesForm({ userId, autoRedirectOnJobStart: initialValue }: PreferencesFormProps) {
    const [autoRedirectOnJobStart, setAutoRedirectOnJobStart] = useState(initialValue);
    const [isPending, startTransition] = useTransition();

    const handleToggle = (checked: boolean) => {
        setAutoRedirectOnJobStart(checked);

        startTransition(async () => {
            try {
                const result = await updateUserPreferences(userId, { autoRedirectOnJobStart: checked });
                if (result.success) {
                    toast.success("Preference saved");
                } else {
                    // Revert on error
                    setAutoRedirectOnJobStart(!checked);
                    toast.error(result.error || "Failed to save preference");
                }
            } catch {
                // Revert on error
                setAutoRedirectOnJobStart(!checked);
                toast.error("An error occurred");
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Behavior</CardTitle>
                <CardDescription>
                    Configure how the application behaves during various operations.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label htmlFor="auto-redirect" className="text-base font-medium">
                            Auto-redirect on job start
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Automatically navigate to the History page and open the live execution view
                            when a backup or restore job starts.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        <Switch
                            id="auto-redirect"
                            checked={autoRedirectOnJobStart}
                            onCheckedChange={handleToggle}
                            disabled={isPending}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
