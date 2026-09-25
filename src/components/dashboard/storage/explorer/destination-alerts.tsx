"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, Pencil } from "lucide-react";
import { updateStorageAlertSettings } from "@/app/actions/storage/storage-alerts";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn, formatBytes } from "@/lib/utils";
import type { DestinationAlerts, ExplorerDestination } from "@/services/storage/explorer-types";

const UNITS = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 } as const;
type Unit = keyof typeof UNITS;

/** A limit in the largest unit it is a whole number of, GB when it is not one. */
function splitBytes(bytes: number): { value: number; unit: Unit } {
    for (const unit of ["TB", "GB", "MB"] as const) {
        if (bytes >= UNITS[unit] && bytes % UNITS[unit] === 0) return { value: bytes / UNITS[unit], unit };
    }
    return { value: Math.max(1, Math.round(bytes / UNITS.GB)), unit: "GB" };
}

interface AlertLine {
    name: string;
    rule: string;
    enabled: boolean;
    active: boolean;
    /** The color of an alert that fires: red when backups are missing, amber else. */
    tone: "warning" | "destructive";
}

function linesOf(alerts: DestinationAlerts): AlertLine[] {
    return [
        // The spike compares every measurement with the one before it, and a shrinking destination counts too.
        { name: "Usage spike", rule: `A change of more than ${alerts.usageSpike.percent} % between two measurements`, ...alerts.usageSpike, tone: "warning" },
        { name: "Storage limit", rule: alerts.storageLimit.bytes > 0 ? `Above ${formatBytes(alerts.storageLimit.bytes)}` : "No limit set", ...alerts.storageLimit, tone: "warning" },
        { name: "Missing backup", rule: `Nothing new for ${alerts.missingBackup.hours} hours`, ...alerts.missingBackup, tone: "destructive" },
    ];
}

/** The three alerts of a destination with what they watch and whether they fire, beside its storage history. */
export function DestinationAlertsCard({ destination, onEdit }: { destination: ExplorerDestination; onEdit?: () => void }) {
    const lines = linesOf(destination.alerts);
    const on = lines.filter((line) => line.enabled).length;
    const active = lines.filter((line) => line.enabled && line.active).length;
    return (
        <section className="min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="font-semibold">Alerts</h3>
                    <p className="text-sm text-muted-foreground">{on === 0 ? "None on" : `${on} on, ${active === 0 ? "none" : active} active`}</p>
                </div>
                {onEdit && (
                    <Button variant="outline" size="sm" onClick={onEdit}>
                        <Pencil />
                        Edit
                    </Button>
                )}
            </div>
            <ul className="mt-3 divide-y">
                {lines.map((line) => (
                    <li key={line.name} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{line.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{line.rule}</p>
                        </div>
                        <span
                            className={cn(
                                "inline-flex shrink-0 items-center gap-1.5 text-xs",
                                !line.enabled ? "text-muted-foreground" : line.active ? (line.tone === "destructive" ? "font-medium text-destructive" : "font-medium text-warning") : "text-muted-foreground"
                            )}
                        >
                            {line.enabled && (
                                <span className={cn("size-1.5 rounded-full", line.active ? (line.tone === "destructive" ? "bg-destructive" : "bg-warning") : "bg-success")} aria-hidden="true" />
                            )}
                            {!line.enabled ? "Off" : line.active ? "Active" : "All well"}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

interface DialogProps {
    destination: ExplorerDestination;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

/** Edits the alerts of a destination. The notifications go out through the channels set up in Settings. */
export function DestinationAlertsDialog({ destination, open, onOpenChange, onSaved }: DialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                {/* A fresh form each time it opens, from what the destination has now. */}
                {open && <AlertsForm destination={destination} onClose={() => onOpenChange(false)} onSaved={onSaved} />}
            </DialogContent>
        </Dialog>
    );
}

function AlertsForm({ destination, onClose, onSaved }: { destination: ExplorerDestination; onClose: () => void; onSaved: () => void }) {
    const { usageSpike, storageLimit, missingBackup } = destination.alerts;
    const [spikeOn, setSpikeOn] = useState(usageSpike.enabled);
    const [percent, setPercent] = useState(usageSpike.percent);
    const [limitOn, setLimitOn] = useState(storageLimit.enabled);
    const [limit, setLimit] = useState(splitBytes(storageLimit.bytes));
    const [missingOn, setMissingOn] = useState(missingBackup.enabled);
    const [hours, setHours] = useState(missingBackup.hours);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const result = await updateStorageAlertSettings(destination.id, {
                usageSpikeEnabled: spikeOn,
                usageSpikeThresholdPercent: percent,
                storageLimitEnabled: limitOn,
                storageLimitBytes: limit.value * UNITS[limit.unit],
                missingBackupEnabled: missingOn,
                missingBackupHours: hours,
            });
            if (!result.success) {
                toast.error(result.error ?? "The alerts could not be saved");
                return;
            }
            toast.success(`Alerts of ${destination.name} saved`);
            onSaved();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <DialogHead tone="edit" icon={Bell}>
                <DialogTitle className="text-base">Alerts of {destination.name}</DialogTitle>
                <DialogDescription className="text-xs font-medium text-tone">A notification goes out when one fires</DialogDescription>
            </DialogHead>
            <div className="divide-y px-5 py-1">
                <Setting title="Usage spike" note="When its size grows or shrinks by more than" on={spikeOn} onToggle={setSpikeOn}>
                    <NumberStepper value={percent} onValueChange={setPercent} min={1} max={1000} disabled={!spikeOn} aria-label="Change in percent" decrementLabel="Less" incrementLabel="More" />
                    <span className="text-sm text-muted-foreground">% between two measurements</span>
                </Setting>
                <Setting title="Storage limit" note="When it stores more than" on={limitOn} onToggle={setLimitOn}>
                    <NumberStepper value={limit.value} onValueChange={(value) => setLimit({ ...limit, value })} min={1} max={100_000} disabled={!limitOn} aria-label="Limit" decrementLabel="Less" incrementLabel="More" />
                    <Select value={limit.unit} onValueChange={(unit) => setLimit({ ...limit, unit: unit as Unit })} disabled={!limitOn}>
                        <SelectTrigger className="h-9 w-20" aria-label="Unit">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.keys(UNITS).map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </Setting>
                <Setting title="Missing backup" note="When nothing new arrives for" on={missingOn} onToggle={setMissingOn}>
                    <NumberStepper value={hours} onValueChange={setHours} min={1} max={8760} disabled={!missingOn} aria-label="Hours" decrementLabel="Fewer hours" incrementLabel="More hours" />
                    <span className="text-sm text-muted-foreground">hours</span>
                </Setting>
            </div>
            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button onClick={() => void save()} disabled={saving}>
                    {saving && <Loader2 className="animate-spin" />}
                    Save alerts
                </Button>
            </div>
        </>
    );
}

function Setting({ title, note, on, onToggle, children }: { title: string; note: string; on: boolean; onToggle: (on: boolean) => void; children: React.ReactNode }) {
    return (
        <div className="space-y-2.5 py-4">
            <div className="flex items-center gap-3">
                <Switch checked={on} onCheckedChange={onToggle} aria-label={title} />
                <div className="min-w-0">
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{note}</p>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-12">{children}</div>
        </div>
    );
}
