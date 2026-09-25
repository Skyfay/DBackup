"use client";

import * as React from "react";
import { Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { X, Settings2, RefreshCw, Search } from "lucide-react";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import type { DataTableFilterableColumn } from "./data-table-types";
import { cn } from "@/lib/utils";

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    searchKey: string;
    filterableColumns: DataTableFilterableColumn<TData>[];
    onRefresh?: () => void;
    isLoading?: boolean;
    variant?: "default" | "card";
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
    variant = "default",
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
            />
        ) : null
    );

    if (variant === "card") {
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
                    {onRefresh && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onRefresh}
                            aria-label="Refresh"
                            className="size-8 p-0 text-muted-foreground"
                            disabled={isLoading}
                        >
                            <RefreshCw className={cn(isLoading && "animate-spin")} />
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-between py-4">
            <div className="flex flex-1 items-center space-x-2">
                <Input
                    placeholder="Filter..."
                    value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
                    onChange={(event) =>
                        table.getColumn(searchKey)?.setFilterValue(event.target.value)
                    }
                    className="h-8 w-37.5 lg:w-62.5"
                />
                {facetedFilters}
                {isFiltered && (
                    <Button
                        variant="ghost"
                        onClick={() => table.resetColumnFilters()}
                        className="h-8 px-2 lg:px-3"
                    >
                        Reset
                        <X className="ml-2 h-4 w-4" />
                    </Button>
                )}
            </div>
            <div className="flex items-center space-x-2">
                {columnSettings ?? <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 hidden lg:flex ml-auto">
                            <Settings2 className="mr-2 h-4 w-4" />
                            View
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-37.5">
                        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {table
                            .getAllColumns()
                            .filter((column) => column.getCanHide())
                            .map((column) => {
                                return (
                                    <DropdownMenuCheckboxItem
                                        key={column.id}
                                        className="capitalize"
                                        checked={column.getIsVisible()}
                                        onCheckedChange={(value) =>
                                            column.toggleVisibility(!!value)
                                        }
                                    >
                                        {column.id}
                                    </DropdownMenuCheckboxItem>
                                );
                            })}
                    </DropdownMenuContent>
                </DropdownMenu>}
                {onRefresh && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRefresh}
                        title="Refresh"
                        className="h-8 w-8 p-0"
                        disabled={isLoading}
                    >
                        <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </Button>
                )}
            </div>
        </div>
    );
}
