"use client";

import * as React from "react";
import { Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Search } from "lucide-react";
import { RefreshButton } from "@/components/ui/refresh-button";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import type { DataTableFilterableColumn } from "./data-table-types";

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    searchKey: string;
    filterableColumns: DataTableFilterableColumn<TData>[];
    /** Loads the list again. A promise keeps the button turning until it settles. */
    onRefresh?: () => unknown;
    isLoading?: boolean;
    searchPlaceholder?: string;
    /** Extra controls after the filters. */
    toolbarExtra?: React.ReactNode;
    /** Replaces the View menu with the Columns menu of a table that keeps its layout. */
    columnSettings?: React.ReactNode;
}

/** Filter input, faceted filter chips, column visibility and refresh. */
export function DataTableToolbar<TData>({
    table,
    searchKey,
    filterableColumns,
    onRefresh,
    isLoading = false,
    searchPlaceholder,
    toolbarExtra,
    columnSettings,
}: DataTableToolbarProps<TData>) {
    const isFiltered = table.getState().columnFilters.length > 0;
    const facetedFilters = filterableColumns.map((column) =>
        table.getColumn(column.id as string) ? (
            <DataTableFacetedFilter
                key={String(column.id)}
                column={table.getColumn(column.id as string)}
                title={column.title}
                options={column.options}
                contentClassName={column.contentClassName}
                unavailableLabel={column.unavailableLabel}
                heading={column.heading}
                note={column.note}
                resultLabel={column.resultLabel}
                hint={column.hint}
            />
        ) : null
    );

    return (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="relative w-full sm:w-auto">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                    placeholder={searchPlaceholder ?? "Search..."}
                    aria-label={searchPlaceholder ?? "Search"}
                    value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
                    onChange={(event) => table.getColumn(searchKey)?.setFilterValue(event.target.value)}
                    className="h-9 w-full pl-8 sm:h-8 sm:w-60"
                />
            </div>
            {facetedFilters}
            {/* Beside the filters it clears, the search included. Extra controls keep their own reset. */}
            {isFiltered && (
                <Button variant="ghost" size="sm" onClick={() => table.resetColumnFilters()} className="h-8 px-2">
                    Reset
                    <X />
                </Button>
            )}
            {toolbarExtra}
            {/* On a phone it follows the filters at the left edge, pushed to the right only once the row has room. */}
            <div className="flex items-center gap-1 sm:ml-auto">
                {columnSettings}
                {onRefresh && <RefreshButton onRefresh={onRefresh} busy={isLoading} label="Refresh" size="sm" className="size-8 p-0 text-muted-foreground" />}
            </div>
        </div>
    );
}
