"use client";

import { useId, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn } from "@/lib/utils";
import { dayStart } from "./assignment-model";

interface StartChoiceProps {
    /** Left out where the row names itself, like the foot of the picker of a row. */
    label?: string;
    /** The first day picked in the calendar, null for now. */
    day: Date | null;
    onChange: (day: Date | null) => void;
    /** Whether a day of the calendar may start it: today or earlier, never later, and not before a limit. */
    isAllowed: (day: Date) => boolean;
    /** Leaves out the earlier day, like while someone holds the database by name. */
    earlierDisabled?: boolean;
    /** One row with smaller pills, for the foot of a popover. */
    compact?: boolean;
    /** The sentence under the field, what the pick means. */
    children?: React.ReactNode;
}

const OPTION = "rounded-md px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-tone-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * When a tenant starts to see the backups of a database: now, or from a day picked in a calendar,
 * which shows the older backups of that time too. A start never lies in the future, so the calendar
 * offers today and earlier. The pills and the field take the tone of the task around them.
 */
export function StartChoice({ label, day, onChange, isAllowed, earlierDisabled = false, compact = false, children }: StartChoiceProps) {
    const { formatDate, timezone } = useDateFormatter();
    const [earlier, setEarlier] = useState(day !== null);
    const [open, setOpen] = useState(false);
    const labelId = useId();
    const fromDay = earlier && !earlierDisabled;

    const option = (on: boolean, text: string, pick: () => void, disabled = false) => (
        <button
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={pick}
            className={cn(OPTION, compact ? "h-6" : "h-7", on ? "bg-tone-control text-tone-control-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
            {text}
        </button>
    );

    return (
        <div className={cn(compact ? "flex flex-wrap items-center gap-2" : "space-y-2")}>
            {label && (compact ? <span id={labelId} className="text-xs text-muted-foreground">{label}</span> : <Label id={labelId}>{label}</Label>)}
            <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : "Starts"} className="flex rounded-lg bg-muted p-0.5">
                    {option(!fromDay, "Now", () => {
                        setEarlier(false);
                        onChange(null);
                    })}
                    {option(fromDay, "From a day", () => {
                        setEarlier(true);
                        setOpen(true);
                    }, earlierDisabled)}
                </div>
                {fromDay && (
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={cn("min-w-36 justify-between font-normal tabular-nums focus-visible:border-tone-ring focus-visible:ring-tone-ring/50", compact && "h-7")}
                                aria-label="The day it starts"
                            >
                                <span className="flex items-center gap-2">
                                    <CalendarDays className="text-muted-foreground" />
                                    {day ? formatDate(dayStart(day, timezone), "P") : <span className="text-muted-foreground">Pick a day</span>}
                                </span>
                                <ChevronDown className="opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-auto overflow-hidden p-0">
                            <Calendar
                                mode="single"
                                selected={day ?? undefined}
                                defaultMonth={day ?? new Date()}
                                endMonth={new Date()}
                                disabled={(candidate) => !isAllowed(candidate)}
                                onSelect={(picked) => {
                                    onChange(picked ?? null);
                                    setOpen(false);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                )}
            </div>
            {children && <div className="text-xs text-muted-foreground">{children}</div>}
        </div>
    );
}
