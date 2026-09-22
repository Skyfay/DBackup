"use client";

import * as React from "react";
import {
    ColumnDef,
    ColumnFiltersState,
    RowSelectionState,
    SortingState,
    VisibilityState,
    PaginationState,
    OnChangeFn,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    useReactTable,
} from "@tanstack/react-table";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableBulkBar } from "./data-table-bulk-bar";
import { selectColumn } from "./data-table-selection";
import { DataTableColumnSettings } from "./data-table-column-settings";
import { useColumnLayout, type ColumnLayoutOption } from "./use-column-layout";
import { cn } from "@/lib/utils";
import type { BulkAction, DataTableFilterableColumn, DataTableFilterOption } from "./data-table-types";

export type { BulkAction, DataTableFilterableColumn, DataTableFilterOption };

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    searchKey?: string;
    filterableColumns?: DataTableFilterableColumn<TData>[];
    initialColumnVisibility?: VisibilityState;
    autoResetPageIndex?: boolean;
    onRefresh?: () => void;
    isLoading?: boolean;

    // Row selection & bulk actions
    /**
     * Shows the leading checkbox column and the bulk action bar.
     *
     * Bind this to the permission boolean resolved on the server. It hides UI only - the
     * endpoint behind every bulk action checks permissions again.
     */
    enableRowSelection?: boolean;
    /**
     * Stable identity per row. Required whenever `enableRowSelection` is set.
     *
     * Without it TanStack keys the selection by row index, so any refetch that reorders or
     * resizes the list leaves the selection pointing at different records. Every consumer
     * here replaces `data` after a mutation, and some poll on a timer.
     */
    getRowId?: (row: TData, index: number) => string;
    /** Rows that may never be selected, whatever the action. Renders a disabled checkbox. */
    isRowSelectable?: (row: TData) => boolean;
    bulkActions?: BulkAction<TData>[];
    /** Runs after a bulk action settles, whether fully or partly successful. Refetch here. */
    onBulkActionComplete?: () => void | Promise<void>;

    /** "card" draws the table as one panel with its toolbar inside, the look of the redesigned pages. */
    variant?: "default" | "card";
    /**
     * Turns on the Columns menu: switch columns on and off, move them, pick a row height.
     * Feed it from `useTableLayout`, which saves the layout to the user's account.
     */
    columnLayout?: ColumnLayoutOption;
    /** Extra controls after the filters, such as quick status filters. */
    toolbarExtra?: React.ReactNode;
    searchPlaceholder?: string;
    /** Rows per page to start with. */
    initialPageSize?: number;

    // Manual Pagination & Sorting Capabilities
    pageCount?: number;
    rowCount?: number;
    pagination?: PaginationState;
    onPaginationChange?: OnChangeFn<PaginationState>;
    sorting?: SortingState;
    onSortingChange?: OnChangeFn<SortingState>;
    columnFilters?: ColumnFiltersState;
    onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>;
    manualPagination?: boolean;
    manualSorting?: boolean;
    manualFiltering?: boolean;
}

export function DataTable<TData, TValue>({
    columns,
    data,
    searchKey = "name",
    filterableColumns = [],
    initialColumnVisibility = {},
    autoResetPageIndex = true,
    onRefresh,
    isLoading = false,
    enableRowSelection = false,
    getRowId,
    isRowSelectable,
    bulkActions = [],
    onBulkActionComplete,
    variant = "default",
    columnLayout,
    toolbarExtra,
    searchPlaceholder,
    initialPageSize = 10,
    pageCount,
    rowCount,
    pagination: controlledPagination,
    onPaginationChange,
    sorting: controlledSorting,
    onSortingChange,
    columnFilters: controlledColumnFilters,
    onColumnFiltersChange,
    manualPagination = false,
    manualSorting = false,
    manualFiltering = false,
}: DataTableProps<TData, TValue>) {
    // Internal state (used if no controlled state is provided)
    const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
    const [internalColumnFilters, setInternalColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
        pageIndex: 0,
        pageSize: initialPageSize,
    });
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialColumnVisibility);
    const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

    // Resolution (Controlled vs Internal)
    const sorting = controlledSorting ?? internalSorting;
    const setSorting = onSortingChange ?? setInternalSorting;

    const columnFilters = controlledColumnFilters ?? internalColumnFilters;
    const setColumnFilters = onColumnFiltersChange ?? setInternalColumnFilters;

    const pagination = controlledPagination ?? internalPagination;
    const setPagination = onPaginationChange ?? setInternalPagination;

    // The select column is prepended here rather than by each consumer, so its position is
    // the same everywhere and permission gating stays a single boolean.
    const tableColumns = React.useMemo(
        () => (enableRowSelection ? [selectColumn<TData>() as ColumnDef<TData, TValue>, ...columns] : columns),
        [enableRowSelection, columns]
    );
    const layout = useColumnLayout(columns, columnLayout, enableRowSelection);

    const table = useReactTable({
        data,
        columns: tableColumns,
        getRowId,
        meta: { density: layout?.density },
        enableRowSelection: enableRowSelection
            ? (row) => (isRowSelectable ? isRowSelectable(row.original) : true)
            : false,
        pageCount: pageCount ?? (manualPagination ? -1 : undefined),
        state: {
            sorting,
            columnFilters,
            columnVisibility: layout?.columnVisibility ?? columnVisibility,
            columnOrder: layout?.columnOrder ?? [],
            rowSelection,
            pagination,
        },
        manualPagination,
        manualSorting,
        manualFiltering,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onPaginationChange: setPagination,
        onColumnVisibilityChange: layout
            ? (updater) => {
                  const next = typeof updater === "function" ? updater(layout.columnVisibility) : updater;
                  layout.setHidden(Object.keys(next).filter((id) => next[id] === false));
              }
            : setColumnVisibility,
        onRowSelectionChange: setRowSelection,

        // When pagination is controlled externally, auto-reset would overwrite the parent's pageIndex on every data update.
        autoResetPageIndex: manualPagination ? false : autoResetPageIndex,
        getCoreRowModel: getCoreRowModel(),
        // Only use client-side models if NOT manual
        getPaginationRowModel: !manualPagination ? getPaginationRowModel() : undefined,
        getSortedRowModel: !manualSorting ? getSortedRowModel() : undefined,
        getFilteredRowModel: !manualFiltering ? getFilteredRowModel() : undefined,
        getFacetedRowModel: !manualFiltering ? getFacetedRowModel() : undefined,
        getFacetedUniqueValues: !manualFiltering ? getFacetedUniqueValues() : undefined,
    });

    // TanStack keeps selection keys for rows that have left `data`. They are invisible in
    // the row models but would still count as "selected" the moment a row with the same id
    // comes back, so drop them whenever the data changes.
    React.useEffect(() => {
        if (!enableRowSelection || !getRowId) return;
        setRowSelection((current) => {
            const keys = Object.keys(current);
            if (keys.length === 0) return current;
            const present = new Set(data.map((row, index) => getRowId(row, index)));
            const stale = keys.filter((key) => !present.has(key));
            if (stale.length === 0) return current;
            const next = { ...current };
            for (const key of stale) delete next[key];
            return next;
        });
    }, [data, enableRowSelection, getRowId]);

    const totalRows = rowCount ?? table.getFilteredRowModel().rows.length;
    // Always read the selection through the row model. The raw record can hold ids that
    // are no longer on screen.
    const selectedRows = enableRowSelection
        ? table.getFilteredSelectedRowModel().rows.map((row) => row.original)
        : [];

    const card = variant === "card";
    const compact = layout?.density === "compact";

    const toolbar = (
        <DataTableToolbar
            table={table}
            searchKey={searchKey}
            filterableColumns={filterableColumns}
            onRefresh={onRefresh}
            isLoading={isLoading}
            variant={variant}
            searchPlaceholder={searchPlaceholder}
            toolbarExtra={toolbarExtra}
            columnSettings={layout ? <DataTableColumnSettings {...layout.settings} /> : undefined}
        />
    );
    const bulkBar = enableRowSelection && bulkActions.length > 0 && (
        <DataTableBulkBar
            selectedRows={selectedRows}
            actions={bulkActions}
            onClearSelection={() => setRowSelection({})}
            onComplete={onBulkActionComplete}
        />
    );
    const grid = (
        <Table>
            <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id} className={cn(card && "hover:bg-transparent")}>
                        {headerGroup.headers.map((header) => (
                            <TableHead
                                key={header.id}
                                {...(layout?.headerDrag(header.column.id) ?? {})}
                                className={cn(
                                    card && "px-3 text-xs text-muted-foreground first:pl-4 last:pr-4",
                                    // Movable headers can be dragged, and show where a dragged one lands.
                                    "[&[draggable=true]]:cursor-grab data-[drop-target]:shadow-[inset_2px_0_0_var(--foreground)]"
                                )}
                            >
                                {header.isPlaceholder
                                    ? null
                                    : flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                        ))}
                    </TableRow>
                ))}
            </TableHeader>
            <TableBody>
                {table.getRowModel().rows?.length ? (
                    table.getRowModel().rows.map((row) => (
                        <TableRow
                            key={row.id}
                            data-state={row.getIsSelected() && "selected"}
                            className={cn(
                                card && "[&>td]:px-3 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4",
                                card && (compact ? "[&>td]:py-1" : "[&>td]:py-2.5")
                            )}
                        >
                            {row.getVisibleCells().map((cell) => (
                                <TableCell key={cell.id}>
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell
                            // Counted from the table, not from `columns`, so the
                            // prepended select column does not break the span.
                            colSpan={table.getVisibleLeafColumns().length}
                            className={cn("h-24 text-center", card && "text-muted-foreground")}
                        >
                            No results.
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );

    if (card) {
        return (
            <div className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
                {toolbar}
                {bulkBar && <div className="px-4">{bulkBar}</div>}
                <div className="border-t">{grid}</div>
                <div className="border-t px-2">
                    <DataTablePagination table={table} totalRows={totalRows} />
                </div>
            </div>
        );
    }

    return (
        <div className="w-full">
            {toolbar}
            {bulkBar}
            <div className="rounded-md border overflow-x-auto max-w-[calc(100vw-6rem)] md:max-w-[calc(100vw-22rem)]">
                {grid}
            </div>
            <DataTablePagination table={table} totalRows={totalRows} />
        </div>
    );
}
