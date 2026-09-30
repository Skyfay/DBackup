"use client";

import { useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { PickList, PickTrigger, type PickEntry, type PickGroup } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { offsetLabel } from "./settings-values";

/** "Buenos Aires, Argentina" for America/Argentina/Buenos_Aires, "UTC" for UTC. */
export function zoneName(zone: string): string {
    const parts = zone.split("/").map((part) => part.replace(/_/g, " "));
    if (parts.length === 1) return parts[0];
    const city = parts[parts.length - 1];
    return parts.length > 2 ? `${city}, ${parts.slice(1, -1).join(", ")}` : city;
}

/** A zone as a row of the pick list, with its offset from UTC. */
export const zoneEntry = (zone: string): PickEntry => ({
    id: zone,
    value: zone,
    name: zoneName(zone),
    meta: `${zone} · ${offsetLabel(zone)}`,
    keywords: [zone, zone.replace(/_/g, " ")],
    editable: false,
});

/** The zones by the region they start with, like Europe or America. */
export function regionGroups(zones: string[]): PickGroup[] {
    const regions = new Map<string, string[]>();
    for (const zone of zones) {
        const region = zone.includes("/") ? zone.split("/")[0] : "Other";
        regions.set(region, [...(regions.get(region) ?? []), zone]);
    }
    return [...regions.entries()]
        .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
        .map(([heading, entries]) => ({ heading, entries: entries.map(zoneEntry) }));
}

/** The zones by the region they start with, the one in use on top. */
export function zoneGroups(zones: string[], current: string): PickGroup[] {
    return [{ heading: "In use", entries: [zoneEntry(current)] }, ...regionGroups(zones)];
}

interface TimezoneFieldProps {
    id: string;
    value: string;
    onChange: (zone: string) => void;
    disabled?: boolean;
}

/**
 * Picks the time zone of the scheduler like any other pick field: the zone with its offset from
 * UTC on the button, and a list of every zone the browser knows by region, with a search.
 */
export function TimezoneField({ id, value, onChange, disabled }: TimezoneFieldProps) {
    const [open, setOpen] = useState(false);
    // Browsers disagree on which IANA name is canonical, so a zone stored from one browser can be
    // absent from another's list. It stays pickable on top as the one in use.
    const groups = useMemo(() => (open ? zoneGroups(Intl.supportedValuesOf("timeZone").filter((zone) => zone !== value), value) : []), [open, value]);

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger id={id} icon={Globe} aria-expanded={open} disabled={disabled} className="w-full max-w-md flex-none">
                    <span className="truncate font-medium">{value}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{offsetLabel(value)}</span>
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Globe}
                    title="Pick a time zone"
                    note="Every zone the browser knows"
                    groups={groups}
                    value={value}
                    emptyText="No time zone matches."
                    searchPlaceholder="Search by city or zone"
                    onPick={(zone) => {
                        onChange(zone);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
