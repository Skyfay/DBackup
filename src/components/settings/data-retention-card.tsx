"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Activity, Archive, Bell, HardDrive, History, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { updateDataRetentionSettingAction } from "@/app/actions/settings/data-retention"
import {
    DATA_RETENTION_SETTINGS,
    type DataRetentionId,
    type DataRetentionSetting,
    formatRetentionDays,
} from "@/lib/core/data-retention"

const ICONS: Record<DataRetentionId, LucideIcon> = {
    executionLogs: ScrollText,
    executionHistory: History,
    auditLog: ShieldCheck,
    notificationHistory: Bell,
    storageUsage: HardDrive,
    healthChecks: Activity,
}

const COUNT_LABELS: Record<DataRetentionId, [singular: string, plural: string]> = {
    executionLogs: ["run with logs", "runs with logs"],
    executionHistory: ["run", "runs"],
    auditLog: ["entry", "entries"],
    notificationHistory: ["notification", "notifications"],
    storageUsage: ["measurement", "measurements"],
    healthChecks: ["check", "checks"],
}

interface DataRetentionCardProps {
    initialValues: Record<DataRetentionId, number>
    counts: Record<DataRetentionId, number>
    canManage: boolean
}

export function DataRetentionCard({ initialValues, counts, canManage }: DataRetentionCardProps) {
    const [values, setValues] = useState(initialValues)

    const handleChange = (setting: DataRetentionSetting, raw: string) => {
        const days = Number(raw)
        const previous = values[setting.id]
        setValues((current) => ({ ...current, [setting.id]: days }))

        const save = updateDataRetentionSettingAction({ id: setting.id, days }).then((result) => {
            if (!result.success) throw new Error(result.error)
        })

        toast.promise(save, {
            loading: "Saving settings...",
            success: "Settings saved",
            error: (err: Error) => {
                setValues((current) => ({ ...current, [setting.id]: previous }))
                return `Failed to save: ${err.message || "Unknown error"}`
            },
        })
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Archive className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Data Retention</CardTitle>
                </div>
                <CardDescription>
                    How long DBackup keeps its own records. Cleanup runs daily with the &quot;Clean Old Data&quot;
                    system task. Backup files on your destinations are never touched here, they follow the
                    retention policy of each job.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="divide-y">
                    {DATA_RETENTION_SETTINGS.map((setting) => {
                        const Icon = ICONS[setting.id]
                        const count = counts[setting.id]
                        const [singular, plural] = COUNT_LABELS[setting.id]
                        const fieldId = `retention-${setting.id}`

                        return (
                            <div
                                key={setting.id}
                                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <Label htmlFor={fieldId}>{setting.label}</Label>
                                        <span className="text-xs text-muted-foreground">
                                            {count.toLocaleString()} {count === 1 ? singular : plural}
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{setting.description}</p>
                                </div>
                                <Select
                                    value={String(values[setting.id])}
                                    onValueChange={(val) => handleChange(setting, val)}
                                    disabled={!canManage}
                                >
                                    <SelectTrigger id={fieldId} className="w-full shrink-0 sm:w-48">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {setting.choices.map((days) => (
                                            <SelectItem key={days} value={String(days)}>
                                                {formatRetentionDays(days)}
                                                {days === setting.defaultDays ? " (Default)" : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )
                    })}
                </div>
                <p className="text-xs text-muted-foreground">
                    Removed records free space inside the database file. The file itself only shrinks after
                    optimizing the database below.
                </p>
            </CardContent>
        </Card>
    )
}
