"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";
import { count } from "./explorer-format";
import { DestinationTile } from "./explorer-cells";

function destinationMeta(destination: ExplorerDestination): string {
    if (!destination.listedAt) return destination.listing ? "Listing" : destination.listError ? "Could not be listed" : "Not listed yet";
    return `${count(destination.count, "backup")} · ${formatBytes(destination.size, 1)}`;
}

interface ExplorerPickerProps {
    destinations: ExplorerDestination[];
    /** The id of the picked destination. */
    value: string | null;
    onChange: (value: string) => void;
}

/** Picks the destination the Destinations tab shows, with a search. */
export function ExplorerPicker({ destinations, value, onChange }: ExplorerPickerProps) {
    const [open, setOpen] = useState(false);
    const picked = destinations.find((destination) => destination.id === value) ?? null;

    const pick = (next: string) => {
        onChange(next);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-label="Pick a destination"
                    className="h-9 w-full min-w-0 justify-between gap-2 px-3 md:w-104"
                >
                    <span className="flex min-w-0 items-center gap-2">
                        {picked && <DestinationTile destination={picked} size="sm" />}
                        <span className="truncate font-medium">{picked?.name ?? "Pick a destination"}</span>
                        <span className="hidden truncate font-normal text-muted-foreground sm:inline">{picked ? destinationMeta(picked) : ""}</span>
                    </span>
                    <ChevronsUpDown className="shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden rounded-xl bg-raised p-0 md:min-w-120" align="start">
                <Command>
                    <CommandInput placeholder="Search destinations" />
                    <CommandList>
                        <CommandEmpty>No destination found.</CommandEmpty>
                        <CommandGroup heading="Destinations">
                            {destinations.map((destination) => (
                                <CommandItem key={destination.id} value={`${destination.name} ${destination.id}`} onSelect={() => pick(destination.id)} className="gap-3 py-2">
                                    <DestinationTile destination={destination} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{destination.name}</span>
                                        <span className="block truncate text-xs text-muted-foreground">{destinationMeta(destination)}</span>
                                    </span>
                                    <Check className={cn("shrink-0", destination.id === value ? "opacity-100" : "opacity-0")} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
