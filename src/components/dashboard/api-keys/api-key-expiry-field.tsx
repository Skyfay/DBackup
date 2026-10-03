"use client";

import { useId, useState } from "react";
import { endOfDay } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";

export type ExpiryChoice = "never" | "30d" | "90d" | "1y" | "date";

const DAY = 86_400_000;
const SPANS: Record<Exclude<ExpiryChoice, "never" | "date">, number> = { "30d": 30, "90d": 90, "1y": 365 };
const LABELS: Record<ExpiryChoice, string> = { never: "Never", "30d": "30d", "90d": "90d", "1y": "1y", date: "Date" };

/** The day a choice ends on, counted from now, null for never. */
export function expiryOf(choice: ExpiryChoice, date: Date | null, now = Date.now()): Date | null {
    if (choice === "never") return null;
    if (choice === "date") return date;
    return new Date(now + SPANS[choice] * DAY);
}

interface ExpiryFieldProps {
    choice: ExpiryChoice;
    date: Date | null;
    onChange: (choice: ExpiryChoice, date: Date | null) => void;
}

/**
 * When a key stops working: never, after 30 days, 90 days or a year, or on a day picked in a
 * calendar. A new key starts at 90 days. The line under it says the day, and that the list marks
 * the key two weeks before.
 */
export function ExpiryField({ choice, date, onChange }: ExpiryFieldProps) {
    const [picking, setPicking] = useState(false);
    const labelId = useId();
    const ends = expiryOf(choice, date);
    return (
        <div className="space-y-2">
            <Label id={labelId}>Runs out</Label>
            <div role="radiogroup" aria-labelledby={labelId} className="flex w-full rounded-lg bg-muted p-0.5">
                {(Object.keys(LABELS) as ExpiryChoice[]).map((option) => {
                    const on = option === choice;
                    const button = (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => (option === "date" ? setPicking(true) : onChange(option, null))}
                            className={cn(
                                "h-7 flex-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-tone-ring/50",
                                on ? "bg-tone-control text-tone-control-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {LABELS[option]}
                        </button>
                    );
                    if (option !== "date") return button;
                    return (
                        <Popover key={option} open={picking} onOpenChange={setPicking}>
                            <PopoverTrigger asChild>{button}</PopoverTrigger>
                            <PopoverContent align="end" className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={date ?? undefined}
                                    disabled={(day) => endOfDay(day).getTime() < Date.now()}
                                    onSelect={(day) => {
                                        if (!day) return;
                                        // The key still works on the day it runs out.
                                        onChange("date", endOfDay(day));
                                        setPicking(false);
                                    }}
                                />
                            </PopoverContent>
                        </Popover>
                    );
                })}
            </div>
            <p className="text-xs text-muted-foreground">
                {!ends ? (
                    "Keeps working until someone disables or deletes it."
                ) : ends.getTime() <= Date.now() ? (
                    <>
                        Ran out on <DateDisplay date={ends} format="P" />. Pick a new end to make it work again.
                    </>
                ) : (
                    <>
                        Runs out on <DateDisplay date={ends} format="P" />. The list marks it two weeks before.
                    </>
                )}
            </p>
        </div>
    );
}
