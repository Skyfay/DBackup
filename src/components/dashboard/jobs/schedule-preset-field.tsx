"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check, ChevronsUpDown, Pencil, Plus } from "lucide-react";
import type { SchedulePreset } from "@prisma/client";
import { getSchedulePresets } from "@/app/actions/templates";
import { SchedulePresetDialog } from "@/components/settings/templates/schedule-preset-list";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { describeSchedule } from "./job-schedule";

const log = logger.child({ component: "SchedulePresetField" });

interface SchedulePresetFieldProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    value: string | null;
    onChange: (preset: SchedulePreset | null) => void;
}

/**
 * Picks the schedule preset a job follows. New adds one and picks it, Edit on a row changes one
 * for every job that follows it.
 */
export function SchedulePresetField({ value, onChange, className, ...props }: SchedulePresetFieldProps) {
    const [presets, setPresets] = useState<SchedulePreset[]>([]);
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState<{ open: boolean; preset?: SchedulePreset }>({ open: false });
    const current = presets.find((preset) => preset.id === value);

    useEffect(() => {
        getSchedulePresets()
            .then((res) => {
                if (res.success && res.data) setPresets(res.data);
            })
            .catch((error: unknown) => log.warn("Schedule presets could not be loaded", {}, wrapError(error)));
    }, []);

    return (
        <>
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" role="combobox" aria-expanded={open} className={cn("w-full min-w-0 justify-between font-normal", className)} {...props}>
                        {current ? (
                            <span className="flex min-w-0 items-center gap-2">
                                <CalendarClock className="shrink-0 text-muted-foreground" />
                                <span className="truncate">{current.name}</span>
                                <span className="truncate text-xs text-muted-foreground">{describeSchedule(current.schedule).text}</span>
                            </span>
                        ) : (
                            <span className="text-muted-foreground">Pick a preset</span>
                        )}
                        <ChevronsUpDown className="opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent tone="pick" className="w-(--radix-popover-trigger-width) min-w-72 overflow-hidden p-0" align="start">
                    <Command>
                        <CommandInput placeholder="Search presets" />
                        <CommandList>
                            <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">
                                {presets.length === 0 ? "There are no schedule presets yet." : "No preset matches."}
                            </CommandEmpty>
                            <CommandGroup>
                                {presets.map((preset) => (
                                    <CommandItem
                                        key={preset.id}
                                        value={preset.name}
                                        onSelect={() => {
                                            onChange(preset);
                                            setOpen(false);
                                        }}
                                        className="group gap-2.5"
                                    >
                                        <span className="grid min-w-0 flex-1 gap-0.5">
                                            <span className="truncate font-medium">{preset.name}</span>
                                            <span className="truncate text-xs text-muted-foreground">{describeSchedule(preset.schedule).text}</span>
                                        </span>
                                        {preset.id === value && <Check className="size-4 text-tone" aria-hidden="true" />}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 shrink-0 gap-1 px-2 text-xs md:opacity-0 md:group-hover:opacity-100 md:group-data-[selected=true]:opacity-100 md:focus-visible:opacity-100"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setOpen(false);
                                                setDialog({ open: true, preset });
                                            }}
                                            onKeyDown={(event) => event.stopPropagation()}
                                            aria-label={`Edit ${preset.name}`}
                                        >
                                            <Pencil className="size-3" />
                                            Edit
                                        </Button>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                    <div className="flex items-center border-t bg-page/60 px-3 py-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setOpen(false);
                                setDialog({ open: true });
                            }}
                        >
                            <Plus />
                            New preset
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>

            <SchedulePresetDialog
                open={dialog.open}
                onOpenChange={(next) => setDialog((currentDialog) => ({ ...currentDialog, open: next }))}
                preset={dialog.preset}
                onSuccess={(preset) => {
                    setPresets((list) => [...list.filter((entry) => entry.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)));
                    // A new preset is picked right away, an edited one only refreshes what the job shows.
                    if (!dialog.preset || preset.id === value) onChange(preset);
                    setDialog({ open: false });
                }}
            />
        </>
    );
}
