"use client";

import { Activity, ArchiveRestore, Bell, FileText, HardDrive, History, ScrollText, type LucideIcon } from "lucide-react";
import { saveDataRetentionAction } from "@/app/actions/settings/data-retention";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DATA_RETENTION_SETTINGS, formatRetentionDays, type DataRetentionId } from "@/lib/core/data-retention";
import type { SettingsModel } from "@/services/system/settings-types";
import { PartFrame, SaveBar, useSettingsFrame, usePartSave, usePartValues } from "./settings-frame";
import { changesOf } from "./settings-values";

const ICONS: Record<DataRetentionId, LucideIcon> = {
    executionLogs: FileText,
    executionHistory: History,
    auditLog: ScrollText,
    notificationHistory: Bell,
    storageUsage: HardDrive,
    healthChecks: Activity,
    deletedItems: ArchiveRestore,
};

const COUNT_LABELS: Record<DataRetentionId, [one: string, many: string]> = {
    executionLogs: ["run with logs", "runs with logs"],
    executionHistory: ["run", "runs"],
    auditLog: ["entry", "entries"],
    notificationHistory: ["notification", "notifications"],
    storageUsage: ["measurement", "measurements"],
    healthChecks: ["check", "checks"],
    deletedItems: ["item", "items"],
};

export const RETENTION_FIELDS = Object.fromEntries(
    DATA_RETENTION_SETTINGS.map((setting) => [setting.id, { label: setting.label, show: formatRetentionDays }])
) as Record<DataRetentionId, { label: string; show: (days: number) => string }>;

/** Every record DBackup keeps of itself, how many there are now and how long they stay. */
export function RetentionPart({ model }: { model: SettingsModel["retention"] }) {
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("retention", model.values);
    const save = usePartSave("retention");
    const { values, set } = form;

    return (
        <>
            <PartFrame part="retention" flush>
                <ul className="divide-y">
                    {DATA_RETENTION_SETTINGS.map((setting) => {
                        const Icon = ICONS[setting.id];
                        const count = model.counts[setting.id];
                        const [one, many] = COUNT_LABELS[setting.id];
                        const fieldId = `retention-${setting.id}`;
                        const error = save.errorOf(setting.id);
                        return (
                            <li key={setting.id} data-setting={`retention.${setting.id}`} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center md:px-6">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                        <Icon className="size-4 text-muted-foreground" />
                                    </span>
                                    <div className="min-w-0">
                                        <Label htmlFor={fieldId}>{setting.label}</Label>
                                        <p className="text-xs text-muted-foreground">{setting.description}</p>
                                        {error && <p className="text-xs text-destructive">{error}</p>}
                                    </div>
                                </div>
                                <span className="shrink-0 text-sm tabular-nums text-muted-foreground sm:w-44 sm:text-right">
                                    {count.toLocaleString("en-US")} {count === 1 ? one : many}
                                </span>
                                <Select value={String(values[setting.id])} onValueChange={(days) => set(setting.id, Number(days))} disabled={readOnly}>
                                    <SelectTrigger id={fieldId} className="w-full shrink-0 sm:w-36">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {setting.choices.map((days) => (
                                            <SelectItem key={days} value={String(days)}>
                                                {formatRetentionDays(days)}
                                                {days === setting.defaultDays ? " (default)" : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </li>
                        );
                    })}
                </ul>
                <p className="border-t px-4 py-3 text-xs text-muted-foreground md:px-6">
                    Removed records free space inside the database file. Optimize under Database shrinks the file itself.
                </p>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, RETENTION_FIELDS)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                }}
                onSave={() => save.run(() => saveDataRetentionAction(values), form.commit)}
            />
        </>
    );
}
