"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { offsetLabel } from "./settings-values";

interface TimezoneFieldProps {
    id: string;
    value: string;
    onChange: (zone: string) => void;
    disabled?: boolean;
}

/** Picks the time zone of the scheduler from every zone the browser knows, with its offset from UTC. */
export function TimezoneField({ id, value, onChange, disabled }: TimezoneFieldProps) {
    const [open, setOpen] = useState(false);
    // Browsers disagree on which IANA name is canonical, so a zone stored from one browser can be
    // absent from another's list. The stored one goes first when it is missing, or it could not be found.
    const zones = useMemo(() => {
        const supported = Intl.supportedValuesOf("timeZone");
        return supported.includes(value) ? supported : [value, ...supported];
    }, [value]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button id={id} variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full max-w-md justify-between px-3 font-normal">
                    <span className="flex min-w-0 items-center gap-2">
                        <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate font-medium">{value}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{offsetLabel(value)}</span>
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
                <Command>
                    <CommandInput placeholder="Search a time zone" />
                    <CommandList>
                        <CommandEmpty>No time zone found.</CommandEmpty>
                        <CommandGroup>
                            {zones.map((zone) => (
                                <CommandItem
                                    key={zone}
                                    value={zone}
                                    onSelect={() => {
                                        onChange(zone);
                                        setOpen(false);
                                    }}
                                >
                                    <Check className={cn("size-4", zone === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate">{zone}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground">{offsetLabel(zone)}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
