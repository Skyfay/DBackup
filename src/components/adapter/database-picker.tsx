"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

interface DatabasePickerProps {
    value?: string | string[];
    onChange: (value: string | string[]) => void;
    availableDatabases: string[];
    isLoading: boolean;
    onLoad: () => void;
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
}

export function DatabasePicker({
    value = [],
    onChange,
    availableDatabases,
    isLoading,
    onLoad,
    isOpen,
    setIsOpen,
}: DatabasePickerProps) {
    const currentValues = Array.isArray(value) ? value : (value ? [value] : []);

    const MAX_VISIBLE_BADGES = 8;
    const visibleDbs = currentValues.slice(0, MAX_VISIBLE_BADGES);
    const hiddenCount = currentValues.length - visibleDbs.length;

    return (
        <div className="flex gap-2">
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        className="flex-1 justify-between h-auto min-h-10"
                    >
                        {currentValues.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                                {visibleDbs.map((db) => (
                                    <Badge variant="secondary" key={db} className="mr-1">
                                        {db}
                                    </Badge>
                                ))}
                                {hiddenCount > 0 && (
                                    <Badge variant="outline">
                                        +{hiddenCount} more
                                    </Badge>
                                )}
                            </div>
                        ) : (
                            "Select databases..."
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-100 p-0" align="start">
                    <Command>
                        <CommandInput placeholder="Search databases..." />
                        <CommandList>
                            <CommandEmpty>
                                {isLoading ? (
                                    <div className="flex items-center justify-center p-4">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Loading...
                                    </div>
                                ) : (
                                    "No database found or not loaded."
                                )}
                            </CommandEmpty>
                            <CommandGroup>
                                {availableDatabases.map((db) => (
                                    <CommandItem
                                        value={db}
                                        key={db}
                                        onSelect={(currentValue) => {
                                            const isSelected = currentValues.includes(currentValue);
                                            let newValue;
                                            if (isSelected) {
                                                newValue = currentValues.filter((v) => v !== currentValue);
                                            } else {
                                                newValue = [...currentValues, currentValue];
                                            }
                                            onChange(newValue);
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                currentValues.includes(db) ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        {db}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <Button
                type="button"
                variant="secondary"
                onClick={onLoad}
                disabled={isLoading}
            >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
            </Button>
        </div>
    );
}
