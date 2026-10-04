"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Bell, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { updateStorageAlertsOfMany } from "@/app/actions/storage/storage-alerts";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NumberStepper } from "@/components/ui/number-stepper";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { unwrapBulkAction } from "@/lib/bulk-request";
import type { BulkResult } from "@/lib/core/bulk";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";
import {
    ALERT_KEYS, ALERT_NAMES, afterOf, alertOf, changedDestinations, changesOf, differs, firesRightAway, nowText, startValue, summaryText, valueText,
    type AlertChoice, type AlertKey, type AlertSettings,
} from "./alerts-bulk-model";
import { splitBytes, UNITS, type Unit } from "./destination-alerts";
import { DestinationTile } from "./explorer-cells";

/** Chips for the first destinations in the head, the rest as a count. */
const SHOWN = 6;

interface BulkAlertsDialogProps {
    destinations: ExplorerDestination[];
    onClose: () => void;
    onDone: (result: BulkResult) => void;
}

/**
 * The alerts of several destinations at once. Each alert keeps what every destination has until it
 * is set on or off for all of them, and a list under it shows how each one has it now, or what
 * changes at each once it is set. Only the destinations that change are saved.
 */
export function BulkAlertsDialog({ destinations, onClose, onDone }: BulkAlertsDialogProps) {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "flex max-h-[90dvh] flex-col sm:max-w-2xl")}>
                <BulkAlertsForm destinations={destinations} onClose={onClose} onDone={onDone} />
            </DialogContent>
        </Dialog>
    );
}

function BulkAlertsForm({ destinations, onClose, onDone }: BulkAlertsDialogProps) {
    // The limit starts in whole units, so the number shown is the one saved.
    const [limitStart] = useState(() => splitBytes(startValue("storageLimit", destinations)));
    const [settings, setSettings] = useState<AlertSettings>(() => ({
        usageSpike: { choice: "keep", value: startValue("usageSpike", destinations) },
        storageLimit: { choice: "keep", value: limitStart.value * UNITS[limitStart.unit] },
        missingBackup: { choice: "keep", value: startValue("missingBackup", destinations) },
    }));
    const [limitUnit, setLimitUnit] = useState<Unit>(limitStart.unit);
    const [open, setOpen] = useState<AlertKey[]>([]);
    const [saving, setSaving] = useState(false);

    const change = (key: AlertKey, patch: Partial<AlertSettings[AlertKey]>) => setSettings((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    const changed = changedDestinations(destinations, settings);

    const save = async () => {
        setSaving(true);
        try {
            onDone(await unwrapBulkAction(updateStorageAlertsOfMany(changed.map((destination) => destination.id), changesOf(settings))));
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "The alerts could not be saved");
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <DialogHead tone="edit" icon={Bell}>
                <DialogTitle className="text-base">Alerts of {destinations.length} destinations</DialogTitle>
                <DialogDescription className={dialogNoteClass("edit")}>A notification goes out when one fires</DialogDescription>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {destinations.slice(0, SHOWN).map((destination) => (
                        <span key={destination.id} className="inline-flex h-6 items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium whitespace-nowrap">
                            <AdapterIcon adapterId={destination.adapterId} className="size-3.5" />
                            {destination.name}
                        </span>
                    ))}
                    {destinations.length > SHOWN && <span className="inline-flex h-6 items-center px-1 text-xs text-muted-foreground">and {destinations.length - SHOWN} more</span>}
                </div>
            </DialogHead>

            {/* The dialog only has a max-height, so the viewport carries its own, less the head and the foot. */}
            <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-13rem)]">
                <div className="divide-y px-5">
                    {ALERT_KEYS.map((key) => (
                        <AlertSection
                            key={key}
                            alertKey={key}
                            destinations={destinations}
                            settings={settings}
                            limitUnit={limitUnit}
                            onLimitUnit={setLimitUnit}
                            onChange={(patch) => change(key, patch)}
                            open={open.includes(key)}
                            onOpenChange={(value) => setOpen((current) => (value ? [...current, key] : current.filter((entry) => entry !== key)))}
                        />
                    ))}
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center gap-3")}>
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">{summaryText(destinations, settings)}</p>
                <Button variant="outline" onClick={onClose} disabled={saving}>
                    Cancel
                </Button>
                <Button onClick={() => void save()} disabled={saving || changed.length === 0}>
                    {saving && <Loader2 className="animate-spin" />}
                    {changed.length === 1 ? "Save for 1" : `Save for ${changed.length}`}
                </Button>
            </div>
        </>
    );
}

interface AlertSectionProps {
    alertKey: AlertKey;
    destinations: ExplorerDestination[];
    settings: AlertSettings;
    limitUnit: Unit;
    onLimitUnit: (unit: Unit) => void;
    onChange: (patch: Partial<AlertSettings[AlertKey]>) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function AlertSection({ alertKey: key, destinations, settings, limitUnit, onLimitUnit, onChange, open, onOpenChange }: AlertSectionProps) {
    const setting = settings[key];
    const all = destinations.length === 2 ? "for both" : `for all ${destinations.length}`;
    const limit = key === "storageLimit";

    return (
        <section aria-label={ALERT_NAMES[key]} className="py-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{ALERT_NAMES[key]}</p>
                    <p className="text-xs text-muted-foreground">{nowText(key, destinations)}</p>
                </div>
                <Tabs value={setting.choice} onValueChange={(choice) => onChange({ choice: choice as AlertChoice })} className="gap-0">
                    <TabsList className="h-8" aria-label={`What happens to ${ALERT_NAMES[key]}`}>
                        <TabsTrigger value="keep" className="px-2.5 text-xs">Keep as it is</TabsTrigger>
                        <TabsTrigger value="on" className="px-2.5 text-xs">On</TabsTrigger>
                        <TabsTrigger value="off" className="px-2.5 text-xs">Off</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {setting.choice === "on" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {limit ? (
                        <>
                            <NumberStepper
                                value={Math.max(1, Math.round(setting.value / UNITS[limitUnit]))}
                                onValueChange={(value) => onChange({ value: value * UNITS[limitUnit] })}
                                min={1}
                                max={100_000}
                                aria-label="Limit"
                                decrementLabel="Less"
                                incrementLabel="More"
                            />
                            <Select
                                value={limitUnit}
                                onValueChange={(unit) => {
                                    onLimitUnit(unit as Unit);
                                    onChange({ value: Math.max(1, Math.round(setting.value / UNITS[limitUnit])) * UNITS[unit as Unit] });
                                }}
                            >
                                <SelectTrigger className="h-9 w-20" aria-label="Unit">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.keys(UNITS).map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </>
                    ) : (
                        <>
                            <NumberStepper
                                value={setting.value}
                                onValueChange={(value) => onChange({ value })}
                                min={1}
                                max={key === "usageSpike" ? 1000 : 8760}
                                aria-label={key === "usageSpike" ? "Change in percent" : "Hours"}
                                decrementLabel="Less"
                                incrementLabel="More"
                            />
                            <span className="text-sm text-muted-foreground">{key === "usageSpike" ? "% between two measurements" : "hours"}</span>
                        </>
                    )}
                    <span className="text-xs text-muted-foreground">{all}</span>
                </div>
            )}

            <button
                type="button"
                aria-expanded={open}
                onClick={() => onOpenChange(!open)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-tone-ring/50"
            >
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
                {setting.choice === "keep" ? "How each one has it now" : "What changes at each one"}
            </button>
            {open && (
                <ul className="mt-2 divide-y overflow-hidden rounded-lg border bg-page/40">
                    {destinations.map((destination) => {
                        const before = alertOf(destination, key);
                        const after = afterOf(before, setting);
                        const fires = firesRightAway(destination, key, before, after);
                        return (
                            <li key={destination.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                                <span className="flex w-44 min-w-0 items-center gap-2">
                                    <DestinationTile destination={destination} size="sm" />
                                    <span className="truncate text-sm font-medium">{destination.name}</span>
                                </span>
                                {limit && <span className="w-32 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{formatBytes(destination.size)} stored</span>}
                                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                    {setting.choice === "keep" ? (
                                        <span className="text-muted-foreground">{valueText(key, before)}</span>
                                    ) : differs(before, after) ? (
                                        <>
                                            <span className="text-muted-foreground line-through">{valueText(key, before)}</span>
                                            <ArrowRight className="size-3 text-muted-foreground" aria-label="then" />
                                            <span className={cn("font-medium", fires ? "text-warning" : "text-tone")}>{valueText(key, after)}</span>
                                        </>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            {valueText(key, before)} <span className="text-muted-foreground/80">· stays</span>
                                        </span>
                                    )}
                                    {fires && (
                                        <span className="inline-flex items-center gap-1 rounded-sm bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                                            <TriangleAlert className="size-3" aria-hidden="true" />
                                            fires right away
                                        </span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
