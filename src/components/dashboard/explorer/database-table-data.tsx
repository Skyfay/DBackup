"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import {
    AlertTriangle,
    TableIcon,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Search,
    Settings2,
    RefreshCw,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    PlusCircle,
    Check,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ColumnInfo {
    name: string;
    dataType: string;
    nullable?: boolean;
    primaryKey?: boolean;
    defaultValue?: string;
}

interface DatabaseTableDataProps {
    sourceId: string;
    database: string;
    table: string;
    adapterId: string;
}

const REDIS_ADAPTER = "redis";
const VALKEY_ADAPTER = "valkey";
const MONGO_ADAPTER = "mongodb";

const TYPE_COLORS: Record<string, string> = {
    string: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    hash: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    list: "bg-green-500/10 text-green-600 dark:text-green-400",
    set: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    zset: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    unknown: "bg-muted text-muted-foreground",
};

export function DatabaseTableData({ sourceId, database, table, adapterId }: DatabaseTableDataProps) {
    const [rows, setRows] = useState<Record<string, unknown>[]>([]);
    const [columns, setColumns] = useState<ColumnInfo[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [schemaSearch, setSchemaSearch] = useState("");
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
    const [searchColumn, setSearchColumn] = useState<string | null>(null);
    const [columnPickerOpen, setColumnPickerOpen] = useState(false);
    const [matchMode, setMatchMode] = useState<"contains" | "equals" | "starts" | "ends">("contains");
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

    const handleSort = (colName: string) => {
        if (sortBy === colName) {
            setSortDir(d => d === "asc" ? "desc" : "asc");
        } else {
            setSortBy(colName);
            setSortDir("asc");
        }
        setPage(1);
    };

    // Debounce search input
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 400);
        return () => clearTimeout(t);
    }, [search]);

    // Reset page when search changes
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch]);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/adapters/database-table-data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceId, database, table, page, pageSize, search: (debouncedSearch && searchColumn) ? debouncedSearch : undefined, searchColumn: searchColumn || undefined, matchMode: (debouncedSearch && searchColumn) ? matchMode : undefined, sortBy: sortBy ?? undefined, sortDir: sortBy ? sortDir : undefined }),
            });
            const data = await res.json();

            if (data.success) {
                setRows(data.rows ?? []);
                setColumns(data.columns ?? []);
                setTotalCount(data.totalCount ?? 0);
            } else {
                setError(data.message || "Failed to load data");
                toast.error(data.message || "Failed to load data");
            }
        } catch {
            setError("Connection failed");
            toast.error("Failed to load table data");
        } finally {
            setIsLoading(false);
        }
    }, [sourceId, database, table, page, pageSize, debouncedSearch, searchColumn, matchMode, sortBy, sortDir]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

    const filteredColumns = schemaSearch
        ? columns.filter(col =>
              col.name.toLowerCase().includes(schemaSearch.toLowerCase()) ||
              col.dataType.toLowerCase().includes(schemaSearch.toLowerCase())
          )
        : columns;

    const renderCellValue = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        if (typeof value === "string") return value.length > 120 ? value.slice(0, 120) + "…" : value;
        return String(value);
    };

    const isRedis = adapterId === REDIS_ADAPTER || adapterId === VALKEY_ADAPTER;
    const isMongo = adapterId === MONGO_ADAPTER;

    const visibleCols = columns.filter(col => !hiddenColumns.has(col.name));

    return (
        <div className="space-y-4 min-w-0 w-full">
            <Tabs defaultValue="data">
                <TabsList>
                    <TabsTrigger value="data" className="flex items-center gap-1.5">
                        <TableIcon className="h-3.5 w-3.5" />
                        Data
                    </TabsTrigger>
                    {!isRedis && (
                        <TabsTrigger value="schema">Schema</TabsTrigger>
                    )}
                </TabsList>

                {/* DATA TAB */}
                <TabsContent value="data" className="mt-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">{table}</CardTitle>
                            <CardDescription>
                                {isLoading
                                    ? "Loading..."
                                    : `${totalCount.toLocaleString()} ${isMongo ? "document" : isRedis ? "key" : "row"}${totalCount !== 1 ? "s" : ""} total`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {/* Toolbar */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    {!isRedis && (
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder={searchColumn ? `Search in ${searchColumn}...` : "Search rows..."}
                                                value={search}
                                                onChange={e => setSearch(e.target.value)}
                                                className="pl-8 h-8 w-52"
                                            />
                                        </div>
                                    )}
                                    {!isRedis && columns.length > 0 && (
                                        <Popover open={columnPickerOpen} onOpenChange={setColumnPickerOpen}>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" size="sm" className="h-8">
                                                    <PlusCircle className="mr-2 h-4 w-4" />
                                                    Column
                                                    {searchColumn && (
                                                        <>
                                                            <Separator orientation="vertical" className="mx-2 h-4" />
                                                            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                                                                {searchColumn}
                                                            </Badge>
                                                        </>
                                                    )}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-50 p-0" align="start">
                                                <Command>
                                                    <CommandInput placeholder="Column..." />
                                                    <CommandList>
                                                        <CommandEmpty>No columns found.</CommandEmpty>
                                                        <CommandGroup>
                                                            {columns.map(col => (
                                                                <CommandItem
                                                                    key={col.name}
                                                                    value={col.name}
                                                                    onSelect={() => {
                                                                        setSearchColumn(prev => prev === col.name ? null : col.name);
                                                                        setPage(1);
                                                                        setColumnPickerOpen(false);
                                                                    }}
                                                                >
                                                                    <Check className={cn("mr-2 h-4 w-4 shrink-0", searchColumn === col.name ? "opacity-100" : "opacity-0")} />
                                                                    {col.name}
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </CommandList>
                                                </Command>
                                            </PopoverContent>
                                        </Popover>
                                    )}
                                    {!isRedis && searchColumn && (
                                        <Select
                                            value={matchMode}
                                            onValueChange={(v) => {
                                                setMatchMode(v as "contains" | "equals" | "starts" | "ends");
                                                setPage(1);
                                            }}
                                        >
                                            <SelectTrigger size="sm" className="w-32 text-xs gap-1">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="contains">Contains</SelectItem>
                                                <SelectItem value="equals">Equals</SelectItem>
                                                <SelectItem value="starts">Starts with</SelectItem>
                                                <SelectItem value="ends">Ends with</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {!isRedis && (searchColumn || search) && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 px-2 lg:px-3"
                                            onClick={() => { setSearch(""); setSearchColumn(null); setMatchMode("contains"); setPage(1); }}
                                        >
                                            Reset
                                            <X className="ml-2 h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                                <div className="flex items-center space-x-2">
                                    {columns.length > 0 && !isRedis && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" size="sm" className="h-8 hidden lg:flex ml-auto">
                                                    <Settings2 className="mr-2 h-4 w-4" />
                                                    View
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-37.5">
                                                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                                                <DropdownMenuSeparator />
                                                {columns.map(col => (
                                                    <DropdownMenuCheckboxItem
                                                        key={col.name}
                                                        className="capitalize"
                                                        checked={!hiddenColumns.has(col.name)}
                                                        onCheckedChange={(value) => {
                                                            setHiddenColumns(prev => {
                                                                const next = new Set(prev);
                                                                if (value) next.delete(col.name);
                                                                else next.add(col.name);
                                                                return next;
                                                            });
                                                        }}
                                                    >
                                                        {col.name}
                                                    </DropdownMenuCheckboxItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={fetchData}
                                        title="Refresh"
                                        className="h-8 w-8 p-0"
                                        disabled={isLoading}
                                    >
                                        <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                                    </Button>
                                </div>
                            </div>
                            {error ? (
                                <div className="flex items-center gap-3 text-destructive py-4">
                                    <AlertTriangle className="h-5 w-5 shrink-0" />
                                    <div>
                                        <p className="font-medium">Failed to load data</p>
                                        <p className="text-sm text-muted-foreground">{error}</p>
                                    </div>
                                </div>
                            ) : isLoading ? (
                                <div className="space-y-2">
                                    {[...Array(8)].map((_, i) => (
                                        <div key={i} className="flex gap-4">
                                            {[...Array(Math.min(columns.length || 4, 6))].map((__, j) => (
                                                <Skeleton key={j} className="h-5 flex-1" />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ) : rows.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    <TableIcon className="h-10 w-10 mx-auto mb-2 opacity-30" />
                                    <p className="text-sm">No data found.</p>
                                </div>
                            ) : isRedis ? (
                                <RedisKeyTable rows={rows} />
                            ) : isMongo ? (
                                <MongoDocumentTable columns={columns} rows={rows} renderCellValue={renderCellValue} />
                            ) : (
                                <div className="border rounded-md overflow-x-auto max-w-[calc(100vw-6rem)] md:max-w-[calc(100vw-22rem)]">
                                    <Table>
                                        <TableHeader className="bg-muted/50">
                                            <TableRow className="hover:bg-transparent">
                                                {visibleCols.map(col => (
                                                    <TableHead key={col.name} className="whitespace-nowrap">
                                                        <button
                                                            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                                                            onClick={() => handleSort(col.name)}
                                                        >
                                                            {col.primaryKey && (
                                                                <span className="text-xs font-bold text-primary" title="Primary Key">PK</span>
                                                            )}
                                                            {col.name}
                                                            <span className="text-xs text-muted-foreground font-normal normal-case">
                                                                {col.dataType}
                                                            </span>
                                                            {sortBy === col.name ? (
                                                                sortDir === "asc"
                                                                    ? <ArrowUp className="h-3 w-3 shrink-0" />
                                                                    : <ArrowDown className="h-3 w-3 shrink-0" />
                                                            ) : (
                                                                <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                                                            )}
                                                        </button>
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {rows.map((row, i) => (
                                                <TableRow key={i}>
                                                    {visibleCols.map(col => {
                                                        const val = row[col.name];
                                                        const isEmpty = val === null || val === undefined || val === "";
                                                        return (
                                                            <TableCell
                                                                key={col.name}
                                                                className="whitespace-nowrap max-w-xs overflow-hidden text-ellipsis"
                                                                title={isEmpty ? "NULL" : String(val)}
                                                            >
                                                                {isEmpty ? (
                                                                    <span className="text-muted-foreground/50 italic text-xs">NULL</span>
                                                                ) : (
                                                                    renderCellValue(val)
                                                                )}
                                                            </TableCell>
                                                        );
                                                    })}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}

                            {/* Pagination */}
                            {!error && !isLoading && rows.length > 0 && (
                                <div className="flex items-center justify-between px-2 py-4">
                                    <div className="flex-1 text-sm text-muted-foreground">
                                        {totalCount.toLocaleString()} {isMongo ? "document" : isRedis ? "key" : "row"}{totalCount !== 1 ? "s" : ""} total
                                        {isRedis && totalCount > rows.length && (
                                            <span className="ml-1 text-xs">(showing first {rows.length})</span>
                                        )}
                                    </div>
                                    <div className="flex items-center space-x-6 lg:space-x-8">
                                        <div className="flex items-center space-x-2">
                                            <p className="text-sm font-medium">Rows per page</p>
                                            <Select
                                                value={String(pageSize)}
                                                onValueChange={v => { setPageSize(Number(v)); setPage(1); }}
                                            >
                                                <SelectTrigger className="h-8 w-17.5">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent side="top">
                                                    {[10, 25, 50, 100].map(n => (
                                                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex w-25 items-center justify-center text-sm font-medium">
                                            Page {page} of {pageCount}
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Button
                                                variant="outline"
                                                className="hidden h-8 w-8 p-0 lg:flex"
                                                onClick={() => setPage(1)}
                                                disabled={page <= 1}
                                            >
                                                <span className="sr-only">Go to first page</span>
                                                <ChevronsLeft className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="h-8 w-8 p-0"
                                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                                disabled={page <= 1}
                                            >
                                                <span className="sr-only">Go to previous page</span>
                                                <ChevronLeft className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="h-8 w-8 p-0"
                                                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                                                disabled={page >= pageCount}
                                            >
                                                <span className="sr-only">Go to next page</span>
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="hidden h-8 w-8 p-0 lg:flex"
                                                onClick={() => setPage(pageCount)}
                                                disabled={page >= pageCount}
                                            >
                                                <span className="sr-only">Go to last page</span>
                                                <ChevronsRight className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* SCHEMA TAB */}
                {!isRedis && (
                    <TabsContent value="schema" className="mt-4">
                        <Card>
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div>
                                        <CardTitle className="text-base">Schema</CardTitle>
                                        <CardDescription>
                                            {isMongo ? "Fields derived from sampled documents" : "Column definitions"}
                                        </CardDescription>
                                    </div>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search columns..."
                                            value={schemaSearch}
                                            onChange={e => setSchemaSearch(e.target.value)}
                                            className="pl-8 h-9 w-52"
                                        />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {columns.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No schema information available.</p>
                                ) : (
                                    <div className="border rounded-md overflow-x-auto max-w-[calc(100vw-6rem)] md:max-w-[calc(100vw-22rem)]">
                                        <Table>
                                            <TableHeader className="bg-muted/50">
                                                <TableRow className="hover:bg-transparent">
                                                    <TableHead>Column</TableHead>
                                                    <TableHead>Type</TableHead>
                                                    <TableHead className="w-20">Nullable</TableHead>
                                                    <TableHead className="w-16">PK</TableHead>
                                                    <TableHead>Default</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredColumns.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                                                            No columns match your search.
                                                        </TableCell>
                                                    </TableRow>
                                                ) : filteredColumns.map(col => (
                                                    <TableRow key={col.name}>
                                                        <TableCell className="font-medium font-mono text-sm">{col.name}</TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary" className="font-mono text-xs">
                                                                {col.dataType}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">
                                                            {col.nullable ? "Yes" : "No"}
                                                        </TableCell>
                                                        <TableCell>
                                                            {col.primaryKey && (
                                                                <Badge variant="default" className="text-xs">PK</Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground font-mono">
                                                            {col.defaultValue ?? "-"}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}

function RedisKeyTable({ rows }: { rows: Record<string, unknown>[] }) {
    return (
        <div className="border rounded-md overflow-x-auto">
            <Table>
                <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                        <TableHead>Key</TableHead>
                        <TableHead className="w-28">Type</TableHead>
                        <TableHead className="w-28 text-right">TTL</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row, i) => {
                        const keyType = String(row.type ?? "unknown");
                        const colorClass = TYPE_COLORS[keyType] ?? TYPE_COLORS.unknown;
                        return (
                            <TableRow key={i}>
                                <TableCell className="font-mono text-sm">{String(row.key ?? "")}</TableCell>
                                <TableCell>
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                                        {keyType}
                                    </span>
                                </TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground">
                                    {String(row.ttl ?? "-")}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

function MongoDocumentTable({
    columns,
    rows,
    renderCellValue,
}: {
    columns: ColumnInfo[];
    rows: Record<string, unknown>[];
    renderCellValue: (v: unknown) => string;
}) {
    return (
        <div className="border rounded-md overflow-x-auto">
            <Table>
                <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                        {columns.map(col => (
                            <TableHead key={col.name} className="whitespace-nowrap">
                                <span className="flex items-center gap-1.5">
                                    {col.primaryKey && (
                                        <span className="text-xs font-bold text-primary" title="Primary Key">PK</span>
                                    )}
                                    {col.name}
                                    <span className="text-xs text-muted-foreground font-normal normal-case">
                                        {col.dataType}
                                    </span>
                                </span>
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row, i) => (
                        <TableRow key={i}>
                            {columns.map(col => {
                                const val = row[col.name];
                                const isEmpty = val === null || val === undefined || val === "";
                                return (
                                    <TableCell
                                        key={col.name}
                                        className="whitespace-nowrap max-w-xs overflow-hidden text-ellipsis font-mono text-xs"
                                        title={isEmpty ? "null" : String(val)}
                                    >
                                        {isEmpty ? (
                                            <span className="text-muted-foreground/50 italic">null</span>
                                        ) : (
                                            renderCellValue(val)
                                        )}
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
