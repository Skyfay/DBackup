"use client";

import { useId, useState } from "react";
import { Clock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_TIMES, parseTime, timeText } from "./schedule-model";

/** One line of the picker: what it sets on the left, the controls beside it. */
export function PickerRow({ label, children, aside }: { label: string; children: React.ReactNode; aside?: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-full shrink-0 text-xs text-muted-foreground sm:w-20">{label}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label={label}>
                {children}
            </div>
            {aside && <div className="flex items-center gap-1 sm:ml-auto">{aside}</div>}
        </div>
    );
}

/**
 * A day, an hour step or a minute that can be picked. Picked ones take the tone of the form as a
 * tint, like a picked card, so the only filled button of the dialog stays its save button.
 */
export function Pill({ picked, onClick, children, label }: { picked: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
    return (
        <button
            type="button"
            aria-pressed={picked}
            aria-label={label}
            onClick={onClick}
            className={cn(
                "inline-flex h-8 min-w-11 items-center justify-center rounded-md border px-2.5 text-sm font-medium tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                picked
                    ? "border-tone-control/60 bg-tone-control/5 text-foreground dark:bg-tone-control/10"
                    : "border-input bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:bg-input/30",
            )}
        >
            {children}
        </button>
    );
}

/** A small text button beside the pills, like Weekdays. */
export function QuickPick({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    return (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
            {children}
        </Button>
    );
}

interface TimeFieldProps {
    hour: number;
    minute: number;
    label: string;
    onCommit: (hour: number, minute: number) => void;
    onRemove?: () => void;
}

/**
 * A time typed as 03:00, read when the field is left or Enter is pressed. Its key holds the time,
 * so a time changed from outside, like a suggestion, starts the field over.
 */
function TimeField({ hour, minute, label, onCommit, onRemove }: TimeFieldProps) {
    const [text, setText] = useState(timeText(hour, minute));
    const [invalid, setInvalid] = useState(false);
    const messageId = useId();

    const commit = () => {
        const time = parseTime(text);
        if (!time) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        setText(timeText(time.hour, time.minute));
        if (time.hour !== hour || time.minute !== minute) onCommit(time.hour, time.minute);
    };

    return (
        <span className="grid gap-1">
            <span className="relative flex items-center">
                <Clock className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
                <Input
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commit();
                        }
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={label}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? messageId : undefined}
                    className={cn("h-8 w-28 pl-8 tabular-nums", onRemove && "pr-7")}
                />
                {onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label={`Remove ${timeText(hour, minute)}`}
                        className="absolute right-1.5 rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
            </span>
            {invalid && (
                <span id={messageId} className="text-xs text-destructive">
                    Use a time like 03:00.
                </span>
            )}
        </span>
    );
}

interface TimeListProps {
    hours: number[];
    minute: number;
    onChange: (hours: number[], minute: number) => void;
}

/**
 * The times a schedule starts at. Cron has one minute for all of them, so they share it, and a
 * minute typed into one time moves all of them, which a short line says right then.
 */
export function TimeList({ hours, minute, onChange }: TimeListProps) {
    const [movedTo, setMovedTo] = useState<number | null>(null);
    const add = () => {
        const last = hours[hours.length - 1] ?? 0;
        const next = [12, 6, 18, 3, 9, 15, 21].map((step) => (last + step) % 24).find((hour) => !hours.includes(hour));
        if (next !== undefined) onChange([...hours, next].sort((a, b) => a - b), minute);
    };

    return (
        <>
            {hours.map((hour, index) => (
                <TimeField
                    key={`${index}-${hour}-${minute}`}
                    hour={hour}
                    minute={minute}
                    label={hours.length > 1 ? `Time ${index + 1}` : "Time"}
                    onCommit={(nextHour, nextMinute) => {
                        const rest = hours.filter((_, at) => at !== index);
                        setMovedTo(rest.length > 0 && nextMinute !== minute ? nextMinute : null);
                        onChange([...new Set([...rest, nextHour])].sort((a, b) => a - b), nextMinute);
                    }}
                    onRemove={hours.length > 1 ? () => onChange(hours.filter((_, at) => at !== index), minute) : undefined}
                />
            ))}
            {hours.length < MAX_TIMES && (
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={add}>
                    <Plus />
                    Add time
                </Button>
            )}
            {movedTo !== null && hours.length > 1 && (
                <span className="basis-full text-xs text-muted-foreground">
                    Every time starts at :{String(movedTo).padStart(2, "0")} now, since cron has one minute for all of them.
                </span>
            )}
        </>
    );
}
