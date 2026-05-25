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
    AlertTriangle,
    TableIcon,
    ChevronLeft,
    ChevronRight,
    Search,
} from "lucide-react";
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
                body: JSON.stringify({ sourceId, database, table, page, pageSize, search: debouncedSearch || undefined }),
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
    }, [sourceId, database, table, page, pageSize, debouncedSearch]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

    const renderCellValue = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        if (typeof value === "string") return value.length > 120 ? value.slice(0, 120) + "…" : value;
        return String(value);
    };

    const isRedis = adapterId === REDIS_ADAPTER;
    const isMongo = adapterId === MONGO_ADAPTER;

    return (
        <div className="space-y-4">
            <Tabs defaultValue="data">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <TabsList>
                        <TabsTrigger value="data" className="flex items-center gap-1.5">
                            <TableIcon className="h-3.5 w-3.5" />
                            Data
                        </TabsTrigger>
                        {!isRedis && (
                            <TabsTrigger value="schema">Schema</TabsTrigger>
                        )}
                    </TabsList>

                    {!isRedis && (
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="pl-8 h-9 w-56"
                            />
                        </div>
                    )}
                </div>

                {/* DATA TAB */}
                <TabsContent value="data" className="mt-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div>
                                    <CardTitle className="text-base">{table}</CardTitle>
                                    <CardDescription>
                                        {isLoading
                                            ? "Loading..."
                                            : `${totalCount.toLocaleString()} ${isMongo ? "document" : isRedis ? "key" : "row"}${totalCount !== 1 ? "s" : ""} total`}
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-muted-foreground">Rows per page</span>
                                    <Select
                                        value={String(pageSize)}
                                        onValueChange={v => { setPageSize(Number(v)); setPage(1); }}
                                    >
                                        <SelectTrigger className="h-8 w-20">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {[10, 25, 50, 100].map(n => (
                                                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
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
                                <div className="flex items-center justify-between pt-2">
                                    <p className="text-sm text-muted-foreground">
                                        Page {page} of {pageCount}
                                        {isRedis && totalCount > rows.length && (
                                            <span className="ml-1 text-xs">(showing first {rows.length})</span>
                                        )}
                                    </p>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPage(p => Math.max(1, p - 1))}
                                            disabled={page <= 1}
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                                            disabled={page >= pageCount}
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
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
                                <CardTitle className="text-base">Schema</CardTitle>
                                <CardDescription>
                                    {isMongo ? "Fields derived from sampled documents" : "Column definitions"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {columns.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No schema information available.</p>
                                ) : (
                                    <div className="border rounded-md overflow-hidden">
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
                                                {columns.map(col => (
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
