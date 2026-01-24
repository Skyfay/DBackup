"use client";

import { useState, useEffect, useCallback } from "react";
import { getAuditLogs, getAuditFilterStats } from "@/app/actions/audit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Eye, ChevronLeft, ChevronRight, Search, ChevronsLeft, ChevronsRight, X } from "lucide-react";
import { format } from "date-fns";
import { AuditLog, User } from "@prisma/client";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { toast } from "sonner";
import { DateDisplay } from "@/components/utils/date-display";
import { FacetedFilter } from "@/components/ui/faceted-filter";

// Type definition for Audit Log with included User
type AuditLogWithUser = AuditLog & {
  user: Pick<User, "id" | "name" | "email" | "image"> | null;
};

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface FilterOption {
    value: string;
    count: number;
}

export function AuditTable() {
  const [logs, setLogs] = useState<AuditLogWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });

  // Filters
  const [resourceFilter, setResourceFilter] = useState<string>("ALL");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Dynamic Options
  const [availableActions, setAvailableActions] = useState<FilterOption[]>([]);
  const [availableResources, setAvailableResources] = useState<FilterOption[]>([]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
        setDebouncedSearch(searchQuery);
        setPagination(prev => ({ ...prev, page: 1 }));
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {
        resource: resourceFilter !== "ALL" ? resourceFilter : undefined,
        action: actionFilter !== "ALL" ? actionFilter : undefined,
        search: debouncedSearch || undefined,
      };

      const [logsResult, statsResult] = await Promise.all([
          getAuditLogs(pagination.page, pagination.limit, filters),
          getAuditFilterStats(filters)
      ]);

      if (logsResult.success && logsResult.data) {
        setLogs(logsResult.data.logs as AuditLogWithUser[]);
        setPagination(logsResult.data.pagination);
      } else {
        toast.error("Failed to load audit logs");
      }

      if (statsResult.success && statsResult.data) {
          setAvailableActions(statsResult.data.actions.map((a: any) => ({ value: a.value, count: a.count })));
          setAvailableResources(statsResult.data.resources.map((r: any) => ({ value: r.value, count: r.count })));
      }
    } catch (error) {
      console.error(error);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, resourceFilter, actionFilter, debouncedSearch]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset page when filters change
  const handleFilterChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case AUDIT_ACTIONS.CREATE: return "default"; // Black/White
      case AUDIT_ACTIONS.UPDATE: return "secondary"; // Gray
      case AUDIT_ACTIONS.DELETE: return "destructive"; // Red
      case AUDIT_ACTIONS.LOGIN: return "outline";
      case AUDIT_ACTIONS.EXECUTE: return "default";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-1 items-center space-x-2">
            <Input
                placeholder="Filter logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-[150px] lg:w-[250px]"
            />

            <FacetedFilter
                title="Action"
                value={actionFilter}
                onChange={(val) => handleFilterChange(setActionFilter, val)}
                options={availableActions.map(a => ({ label: a.value, value: a.value, count: a.count }))}
            />

            <FacetedFilter
                title="Resource"
                value={resourceFilter}
                onChange={(val) => handleFilterChange(setResourceFilter, val)}
                options={availableResources.map(r => ({ label: r.value, value: r.value, count: r.count }))}
            />

           {(actionFilter !== "ALL" || resourceFilter !== "ALL" || searchQuery) && (
            <Button
              variant="ghost"
              onClick={() => {
                  setActionFilter("ALL");
                  setResourceFilter("ALL");
                  setSearchQuery("");
              }}
              className="h-8 px-2 lg:px-3"
            >
              Reset
              <X className="ml-2 h-4 w-4" />
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => fetchLogs()} title="Refresh" className="h-8 ml-auto">
             <Search className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <div className="flex justify-center items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                  </div>
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No audit logs found.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={log.user?.image || undefined} />
                        <AvatarFallback>
                          {log.user?.name?.substring(0, 2).toUpperCase() || "??"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{log.user?.name || "System/Deleted"}</span>
                        <span className="text-xs text-muted-foreground">{log.user?.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getActionColor(log.action) as any}>
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{log.resource}</span>
                      {log.resourceId && (
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-[100px]" title={log.resourceId}>
                          {log.resourceId}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {log.details ? (
                       <Dialog>
                       <DialogTrigger asChild>
                         <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                           <Eye className="h-4 w-4" />
                         </Button>
                       </DialogTrigger>
                       <DialogContent className="max-w-[600px]">
                         <DialogHeader>
                           <DialogTitle>Log Details</DialogTitle>
                         </DialogHeader>
                         <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                           <pre className="text-xs font-mono whitespace-pre-wrap">
                             {JSON.stringify(JSON.parse(log.details), null, 2)}
                           </pre>
                         </ScrollArea>
                       </DialogContent>
                     </Dialog>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DateDisplay date={log.createdAt} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between px-2">
        <div className="flex-1 text-sm text-muted-foreground">
           Total {pagination.total} audit logs.
        </div>
        <div className="flex items-center space-x-6 lg:space-x-8">
            <div className="flex items-center space-x-2">
                <p className="text-sm font-medium">Rows per page</p>
                <Select
                    value={`${pagination.limit}`}
                    onValueChange={(value) => {
                        setPagination(prev => ({ ...prev, limit: Number(value), page: 1 }));
                    }}
                >
                    <SelectTrigger className="h-8 w-[70px]">
                        <SelectValue placeholder={pagination.limit} />
                    </SelectTrigger>
                    <SelectContent side="top">
                        {[10, 20, 30, 40, 50].map((pageSize) => (
                            <SelectItem key={pageSize} value={`${pageSize}`}>
                                {pageSize}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="flex w-[100px] items-center justify-center text-sm font-medium">
                Page {pagination.page} of {pagination.pages || 1}
            </div>
            <div className="flex items-center space-x-2">
                <Button
                    variant="outline"
                    className="hidden h-8 w-8 p-0 lg:flex"
                    onClick={() => setPagination(prev => ({ ...prev, page: 1 }))}
                    disabled={pagination.page <= 1 || loading}
                >
                    <span className="sr-only">Go to first page</span>
                    <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                    disabled={pagination.page <= 1 || loading}
                >
                    <span className="sr-only">Go to previous page</span>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    disabled={pagination.page >= pagination.pages || loading}
                >
                    <span className="sr-only">Go to next page</span>
                    <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    className="hidden h-8 w-8 p-0 lg:flex"
                    onClick={() => setPagination(prev => ({ ...prev, page: pagination.pages }))}
                    disabled={pagination.page >= pagination.pages || loading}
                >
                    <span className="sr-only">Go to last page</span>
                    <ChevronsRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
      </div>
    </div>
  );
}
