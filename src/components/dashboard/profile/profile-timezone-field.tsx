"use client";

import { useMemo, useState } from "react";
import { Globe, MonitorSmartphone } from "lucide-react";
import { regionGroups, zoneEntry } from "@/components/dashboard/settings/timezone-field";
import { offsetLabel } from "@/components/dashboard/settings/settings-values";
import { PickList, PickTrigger, type PickGroup } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The id of the row that stands for the zone of the browser, which is stored as empty. */
const AUTOMATIC = "automatic";

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * The time zone of a person like the one of the scheduler under Settings, with This browser on top,
 * which follows whatever zone the browser is in and is stored as empty.
 */
export function ProfileTimezoneField({ id, value, onChange }: { id: string; value: string; onChange: (zone: string) => void }) {
    const [open, setOpen] = useState(false);
    const groups = useMemo((): PickGroup[] => {
        if (!open) return [];
        const zone = browserZone();
        const automatic = { id: AUTOMATIC, value: AUTOMATIC, name: "This browser", meta: `${zone} · ${offsetLabel(zone)}`, glyph: MonitorSmartphone, editable: false, keywords: ["automatic", zone] };
        const zones = Intl.supportedValuesOf("timeZone").filter((entry) => entry !== value);
        return [
            { heading: "Follows the browser", entries: [automatic] },
            ...(value ? [{ heading: "In use", entries: [zoneEntry(value)] }] : []),
            ...regionGroups(zones),
        ];
    }, [open, value]);
    const shown = value || browserZone();

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger id={id} icon={value ? Globe : MonitorSmartphone} aria-expanded={open} className="w-full max-w-md flex-none">
                    <span className="truncate font-medium">{value ? value : "This browser"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{value ? offsetLabel(value) : `${shown} · ${offsetLabel(shown)}`}</span>
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden p-0">
                <PickList
                    icon={Globe}
                    title="Pick a time zone"
                    note="Or follow the browser"
                    groups={groups}
                    value={value || AUTOMATIC}
                    emptyText="No time zone matches."
                    searchPlaceholder="Search by city or zone"
                    onPick={(zone) => {
                        onChange(zone === AUTOMATIC ? "" : zone);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
