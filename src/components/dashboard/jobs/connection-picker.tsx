"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { cn } from "@/lib/utils";
import type { AdapterOption } from "./job-form-schema";

interface ConnectionPickerProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    options: AdapterOption[];
    value: string;
    onChange: (id: string) => void;
    placeholder: string;
    /** Connections other rows use already, left out of the list. */
    taken?: string[];
}

const typeName = (adapterId: string) => getAdapterDefinition(adapterId)?.name ?? adapterId;

/**
 * Picks one connection, with its icon and its type. A list of existing entries, so it opens in the
 * turquoise of picking. The props of a form field land on the button, so its label names it.
 */
export function ConnectionPicker({ options, value, onChange, placeholder, taken = [], className, ...props }: ConnectionPickerProps) {
    const [open, setOpen] = useState(false);
    const current = options.find((option) => option.id === value);
    const available = options.filter((option) => option.id === value || !taken.includes(option.id));

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn("w-full min-w-0 justify-between font-normal", !current && "text-muted-foreground", className)}
                    {...props}
                >
                    {current ? (
                        <span className="flex min-w-0 items-center gap-2">
                            <AdapterIcon adapterId={current.adapterId} className="size-4 shrink-0" />
                            <span className="truncate">{current.name}</span>
                        </span>
                    ) : (
                        placeholder
                    )}
                    <ChevronsUpDown className="opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent tone="pick" className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search" />
                    <CommandList>
                        <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing matches.</CommandEmpty>
                        <CommandGroup>
                            {available.map((option) => (
                                <CommandItem
                                    key={option.id}
                                    value={`${option.name} ${typeName(option.adapterId)}`}
                                    onSelect={() => {
                                        onChange(option.id);
                                        setOpen(false);
                                    }}
                                    className="gap-2.5"
                                >
                                    <AdapterIcon adapterId={option.adapterId} className="size-4 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground">{typeName(option.adapterId)}</span>
                                    <Check className={cn("size-4 shrink-0 text-tone", option.id === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
