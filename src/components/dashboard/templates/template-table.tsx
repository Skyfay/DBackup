"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type BulkAction, type DataTableFilterableColumn, type RowMenuBulk } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Skeleton } from "@/components/ui/skeleton";
import type { ColumnLayoutOption } from "@/components/ui/use-column-layout";
import { cn } from "@/lib/utils";
import { matchesQuick, quickOptions, type TemplateQuick } from "./template-format";

interface TemplateTableProps<T extends { id: string }> {
    /** Null while the templates load. */
    rows: T[] | null;
    isLoading: boolean;
    onRefresh: () => void;
    columns: ColumnDef<T>[];
    filters?: DataTableFilterableColumn<T>[];
    searchPlaceholder: string;
    /** What the quick filters split the rows by. */
    inUse: (row: T) => boolean;
    /** What the list is, for screen readers while it loads. */
    loadingLabel: string;
    cards: boolean;
    /** Whether rows can be picked for a bulk action, never on a phone. */
    selectable: boolean;
    bulkActions: BulkAction<T>[];
    onBulkActionComplete: () => void;
    layout: ColumnLayoutOption;
    onOpen: (row: T) => void;
    renderCard: (row: T) => React.ReactNode;
    renderRowMenu: (row: T, bulk: RowMenuBulk<T> | null) => React.ReactNode;
}

/**
 * The list of one kind of template: search, the filters and the quick filters by use, then the
 * rows, which open the details on a click and a menu on a right click. A phone gets cards.
 */
export function TemplateTable<T extends { id: string }>({
    rows,
    isLoading,
    onRefresh,
    columns,
    filters,
    searchPlaceholder,
    inUse,
    loadingLabel,
    cards,
    selectable,
    bulkActions,
    onBulkActionComplete,
    layout,
    onOpen,
    renderCard,
    renderRowMenu,
}: TemplateTableProps<T>) {
    const [quick, setQuick] = useState<TemplateQuick>("all");
    const shown = useMemo(() => (rows ?? []).filter((row) => matchesQuick(row, quick, inUse)), [rows, quick, inUse]);

    if (!rows) {
        return (
            <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                <span className="sr-only">{loadingLabel}</span>
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-60" />
                    <Skeleton className="h-8 w-24" />
                </div>
                {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            </div>
        );
    }

    return (
        <DataTable
            variant="card"
            joined
            columns={columns}
            data={shown}
            searchKey="name"
            searchPlaceholder={searchPlaceholder}
            filterableColumns={filters}
            toolbarExtra={<QuickFilter aria-label="Filter by use" value={quick} onChange={setQuick} options={quickOptions(rows, inUse)} />}
            onRefresh={onRefresh}
            isLoading={isLoading}
            enableRowSelection={selectable && !cards}
            getRowId={(row) => row.id}
            bulkActions={bulkActions}
            onBulkActionComplete={onBulkActionComplete}
            columnLayout={layout}
            onRowClick={onOpen}
            view={cards ? "cards" : "table"}
            renderCard={(row) => renderCard(row.original)}
            renderRowMenu={renderRowMenu}
        />
    );
}
