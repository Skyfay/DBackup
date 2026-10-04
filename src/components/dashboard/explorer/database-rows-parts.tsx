"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Columns3, ListFilter, PlusCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toneAttribute } from "@/components/ui/tone";
import type { ColumnInfo } from "@/lib/core/interfaces";
import { cn } from "@/lib/utils";

export type MatchMode = "contains" | "equals" | "starts" | "ends";

/** A filter on one column of the rows, which the server applies. */
export interface RowFilter {
    column: string;
    mode: MatchMode;
    value: string;
}

export interface RowSort {
    column: string;
    dir: "asc" | "desc";
}

const MODES: { value: MatchMode; label: string; short: string }[] = [
    { value: "contains", label: "Contains", short: "contains" },
    { value: "equals", label: "Is", short: "is" },
    { value: "starts", label: "Starts with", short: "starts with" },
    { value: "ends", label: "Ends with", short: "ends with" },
];

/**
 * The filter of the rows in the color of filtering: a field that is framed once it holds one, and
 * a popover to pick the column, how it matches and the value.
 */
export function RowsFilter({ columns, filter, onChange, note = "The server looks through the whole table" }: {
    columns: ColumnInfo[];
    filter: RowFilter | null;
    onChange: (filter: RowFilter | null) => void;
    /** Where the server looks, under the title. */
    note?: string;
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<RowFilter>({ column: "", mode: "contains", value: "" });
    const valid = draft.column !== "" && draft.value.trim() !== "";
    const apply = () => {
        if (!valid) return;
        onChange({ ...draft, value: draft.value.trim() });
        setOpen(false);
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) setDraft(filter ?? { column: columns[0]?.name ?? "", mode: "contains", value: "" });
                setOpen(next);
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    {...toneAttribute("filter")}
                    className={cn(
                        "flex h-8 max-w-80 min-w-0 shrink-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm whitespace-nowrap shadow-xs outline-none",
                        "focus-visible:border-tone-ring focus-visible:ring-2 focus-visible:ring-tone-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
                        filter ? "border-tone/50 bg-tone/5 dark:bg-tone/10" : "border-dashed"
                    )}
                >
                    {filter ? (
                        <>
                            <ListFilter className="size-4 shrink-0 text-tone" aria-hidden="true" />
                            <span className="truncate font-medium">{filter.column}</span>
                            <span className="truncate text-muted-foreground">{MODES.find((mode) => mode.value === filter.mode)?.short} {filter.value}</span>
                            <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
                        </>
                    ) : (
                        <>
                            <PlusCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            Filter
                        </>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent tone="filter" className="w-80 overflow-hidden p-0" align="start">
                <DialogHead tone="filter" icon={ListFilter} className="px-4 py-3">
                    <p className="text-sm font-semibold">Filter the rows</p>
                    <p className={cn(dialogNoteClass("filter"), "truncate")}>{note}</p>
                </DialogHead>
                <form
                    className="space-y-3 px-4 py-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        apply();
                    }}
                >
                    <div className="space-y-1.5">
                        <Label htmlFor="rows-filter-column">Column</Label>
                        <Select value={draft.column} onValueChange={(column) => setDraft((current) => ({ ...current, column }))}>
                            <SelectTrigger id="rows-filter-column" className="w-full">
                                <SelectValue placeholder="Pick a column" />
                            </SelectTrigger>
                            <SelectContent>
                                {columns.map((column) => <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <Tabs value={draft.mode} onValueChange={(mode) => setDraft((current) => ({ ...current, mode: mode as MatchMode }))}>
                        <TabsList aria-label="How the value matches" className="grid w-full grid-cols-4">
                            {MODES.map((mode) => <TabsTrigger key={mode.value} value={mode.value} className="px-1 text-xs">{mode.label}</TabsTrigger>)}
                        </TabsList>
                    </Tabs>
                    <div className="space-y-1.5">
                        <Label htmlFor="rows-filter-value">Value</Label>
                        <Input id="rows-filter-value" value={draft.value} onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))} autoComplete="off" />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                        {filter && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    onChange(null);
                                    setOpen(false);
                                }}
                            >
                                <X />
                                Clear
                            </Button>
                        )}
                        <Button type="submit" size="sm" disabled={!valid}>Filter</Button>
                    </div>
                </form>
            </PopoverContent>
        </Popover>
    );
}

/** The sorted column, with a way back to the order of the server. */
export function SortChip({ sort, onClear }: { sort: RowSort; onClear: () => void }) {
    return (
        <Button variant="outline" size="sm" className="h-8" onClick={onClear} aria-label={`Sorted by ${sort.column}, remove the sorting`}>
            {sort.dir === "asc" ? <ArrowUp /> : <ArrowDown />}
            <span className="max-w-40 truncate">{sort.column}</span>
            <X className="text-muted-foreground" />
        </Button>
    );
}

/** Which columns the rows show. */
export function ColumnsMenu({ columns, hidden, onToggle }: { columns: ColumnInfo[]; hidden: Set<string>; onToggle: (column: string, shown: boolean) => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="Pick the columns">
                    <Columns3 />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.map((column) => (
                    <DropdownMenuCheckboxItem key={column.name} checked={!hidden.has(column.name)} onCheckedChange={(shown) => onToggle(column.name, shown === true)} onSelect={(event) => event.preventDefault()}>
                        <span className="truncate font-mono text-xs">{column.name}</span>
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
