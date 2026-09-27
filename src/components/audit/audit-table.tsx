"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getAuditLogs, getAuditFilterStats } from "@/app/actions/audit/audit";
import { DataTable } from "@/components/ui/data-table";
import { useTableDefaults } from "@/components/ui/table-defaults";
import { AuditLogWithUser, columns } from "./columns";
import { toast } from "sonner";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ColumnFiltersState, OnChangeFn, PaginationState } from "@tanstack/react-table";

interface FilterOption {
    value: string;
    count: number;
}

export function AuditTable() {
  const defaults = useTableDefaults();
  const [logs, setLogs] = useState<AuditLogWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Starts with the rows per page of the profile.
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaults.pageSize,
  });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const [totalRows, setTotalRows] = useState(0);
  const [availableActions, setAvailableActions] = useState<FilterOption[]>(
    Object.values(AUDIT_ACTIONS).map(val => ({ value: val, count: 0 }))
  );
  const [availableResources, setAvailableResources] = useState<FilterOption[]>(
    Object.values(AUDIT_RESOURCES).map(val => ({ value: val, count: 0 }))
  );

  // Track previous filters reference to skip stats fetch on pagination-only changes.
  // Reference equality works here because setColumnFilters always produces a new array.
  const prevFiltersRef = useRef<ColumnFiltersState>(columnFilters);

  const fetchLogs = useCallback(async () => {
    const filtersChanged = prevFiltersRef.current !== columnFilters;
    prevFiltersRef.current = columnFilters;

    setIsLoading(true);
    try {
      const actionFilter = (columnFilters.find(f => f.id === "action")?.value as string[])?.[0];
      const resourceFilter = (columnFilters.find(f => f.id === "resource")?.value as string[])?.[0];
      const searchQuery = columnFilters.find(f => f.id === "details")?.value as string;

      const filters = {
        resource: resourceFilter,
        action: actionFilter,
        search: searchQuery,
      };

      const [logsResult, statsResult] = await Promise.all([
        getAuditLogs(pagination.pageIndex + 1, pagination.pageSize, filters),
        filtersChanged ? getAuditFilterStats(filters) : Promise.resolve(null),
      ]);

      if (logsResult.success && logsResult.data) {
        setLogs(logsResult.data.logs as AuditLogWithUser[]);
        setTotalRows(logsResult.data.pagination.total);
      } else {
        toast.error("Failed to load audit logs: " + (logsResult as any).error);
      }

      if (statsResult?.success && statsResult.data) {
        const actionCounts = new Map(statsResult.data.actions.map((a: any) => [a.value, a.count]));
        const resourceCounts = new Map(statsResult.data.resources.map((r: any) => [r.value, r.count]));

        setAvailableActions(Object.values(AUDIT_ACTIONS).map(val => ({
          value: val,
          count: actionCounts.get(val) || 0
        })));

        setAvailableResources(Object.values(AUDIT_RESOURCES).map(val => ({
          value: val,
          count: resourceCounts.get(val) || 0
        })));
      }
    } catch (_error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [pagination.pageIndex, pagination.pageSize, columnFilters]);

  useEffect(() => {
    const timer = setTimeout(fetchLogs, 300);
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  // Reset to page 0 whenever filters change so we don't show page N of a narrower result set.
  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = useCallback((updater) => {
    setPagination(prev => ({ ...prev, pageIndex: 0 }));
    setColumnFilters(updater);
  }, []);

  const filterableColumns = useMemo(() => [
    {
      id: "action",
      title: "Action",
      options: availableActions.map(a => ({ label: a.value, value: a.value, count: a.count }))
    },
    {
      id: "resource",
      title: "Resource",
      options: availableResources.map(r => ({ label: r.value, value: r.value, count: r.count }))
    }
  ], [availableActions, availableResources]);

  return (
    <div className="space-y-4">
      <div className="rounded-md">
        <DataTable
            columns={columns}
            data={logs}
            searchKey="details"

            manualPagination={true}
            manualFiltering={true}
            manualSorting={false}

            pagination={pagination}
            onPaginationChange={setPagination}
            columnFilters={columnFilters}
            onColumnFiltersChange={handleColumnFiltersChange}

            pageCount={Math.ceil(totalRows / pagination.pageSize)}
            rowCount={totalRows}

            filterableColumns={filterableColumns}
            onRefresh={fetchLogs}
            isLoading={isLoading}
        />
      </div>
    </div>
  );
}
