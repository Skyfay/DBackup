"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import type { SchedulePreset } from "@prisma/client";
import { getSchedulePresets } from "@/app/actions/templates";
import { useCan } from "@/components/permissions/permissions-context";
import { SchedulePresetDialog } from "@/components/settings/templates/schedule-preset-dialog";
import { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { describeSchedule } from "./job-schedule";

const log = logger.child({ component: "SchedulePresetField" });

/** A preset with how many jobs follow it. */
type ListedPreset = SchedulePreset & { _count?: { jobs: number } };

const byName = (a: SchedulePreset, b: SchedulePreset) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function usage(preset: ListedPreset): string {
    const count = preset._count?.jobs ?? 0;
    if (count === 0) return "Not used yet";
    return count === 1 ? "Used by 1 job" : `Used by ${count} jobs`;
}

function entryOf(preset: ListedPreset): PickEntry {
    const when = describeSchedule(preset.schedule).text;
    return {
        id: preset.id,
        name: preset.name,
        meta: `${when} · ${usage(preset)}`,
        keywords: [when, ...(preset.description ? [preset.description] : [])],
    };
}

interface SchedulePresetFieldProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    value: string | null;
    onChange: (preset: SchedulePreset | null) => void;
    /** The job the preset is picked for, so a new preset is not warned about the job's own runs. */
    jobId?: string;
}

/**
 * Picks the schedule preset a job follows, like the login field of a connection: the presets
 * in a list that says when each one runs and how many jobs follow it, New beside the field.
 * Edit on a row changes a preset for every job that follows it. New and Edit are left out for a
 * viewer who may not write templates.
 */
export function SchedulePresetField({ value, onChange, jobId, ...props }: SchedulePresetFieldProps) {
    const [presets, setPresets] = useState<ListedPreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState<{ open: boolean; preset?: SchedulePreset }>({ open: false });
    const current = presets.find((preset) => preset.id === value);
    const canWrite = useCan(PERMISSIONS.TEMPLATES.WRITE);

    useEffect(() => {
        getSchedulePresets()
            .then((res) => {
                if (res.success && res.data) setPresets(res.data);
            })
            .catch((error: unknown) => log.warn("Schedule presets could not be loaded", {}, wrapError(error)))
            .finally(() => setLoading(false));
    }, []);

    const openDialog = (preset?: SchedulePreset) => {
        setOpen(false);
        setDialog({ open: true, preset });
    };

    const saved = (preset: SchedulePreset) => {
        // The saved preset comes without its jobs, which a change does not touch.
        setPresets((list) => [...list.filter((entry) => entry.id !== preset.id), { ...preset, _count: list.find((entry) => entry.id === preset.id)?._count }].sort(byName));
        // A new preset is picked right away, an edited one only refreshes what the job shows.
        if (!dialog.preset || preset.id === value) onChange(preset);
        // The preset stays until the dialog has faded out, so its head does not turn into New on the way.
        setDialog((currentDialog) => ({ ...currentDialog, open: false }));
    };

    return (
        <div className="flex min-w-0 gap-2">
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger icon={CalendarClock} loading={loading} disabled={loading} aria-expanded={open} {...props}>
                        {loading ? (
                            <span className="text-muted-foreground">Loading...</span>
                        ) : current ? (
                            <>
                                <span className="truncate">{current.name}</span>
                                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{describeSchedule(current.schedule).text}</span>
                            </>
                        ) : (
                            <span className="truncate text-muted-foreground">{presets.length === 0 ? "No preset yet" : "Pick from Templates"}</span>
                        )}
                    </PickTrigger>
                </PopoverTrigger>
                {/* On the raised surface, so it stands out from the dialog it opens over. */}
                <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                    <PickList
                        icon={CalendarClock}
                        title="Pick from Templates"
                        note="Schedule presets"
                        groups={[{ entries: presets.map(entryOf) }]}
                        value={value}
                        emptyText={presets.length === 0 ? "There is no schedule preset yet." : "Nothing matches."}
                        onPick={(id) => {
                            const preset = presets.find((entry) => entry.id === id);
                            if (preset) onChange(preset);
                            setOpen(false);
                        }}
                        onEdit={canWrite ? (id) => openDialog(presets.find((entry) => entry.id === id)) : undefined}
                        createLabel="New preset"
                        onCreate={canWrite ? () => openDialog() : undefined}
                    />
                </PopoverContent>
            </Popover>
            {canWrite && (
                <Button type="button" variant="outline" onClick={() => openDialog()}>
                    <Plus />
                    New
                </Button>
            )}

            <SchedulePresetDialog
                open={dialog.open}
                onOpenChange={(next) => setDialog((currentDialog) => ({ ...currentDialog, open: next }))}
                preset={dialog.preset}
                jobId={jobId}
                onSuccess={saved}
            />
        </div>
    );
}
