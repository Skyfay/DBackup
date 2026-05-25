"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TableIcon, Database, Rows3 } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/utils";

interface TableInfo {
    name: string;
    rowCount?: number;
    sizeInBytes?: number;
    type?: "table" | "view" | "collection" | "materialized_view";
}

interface DatabaseTableListProps {
    sourceId: string;
    database: string;
    onTableClick: (tableName: string) => void;
}

const TYPE_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    table: { label: "Table", variant: "secondary" },
    view: { label: "View", variant: "outline" },
    collection: { label: "Collection", variant: "secondary" },
    materialized_view: { label: "Mat. View", variant: "outline" },
};

export function DatabaseTableList({ sourceId, database, onTableClick }: DatabaseTableListProps) {
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTables = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setTables([]);

        try {
            const res = await fetch("/api/adapters/database-tables", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceId, database }),
            });
            const data = await res.json();

            if (data.success && data.tables) {
                setTables(data.tables);
            } else {
                setError(data.message || "Failed to load tables");
                toast.error(data.message || "Failed to load tables");
            }
        } catch {
            setError("Connection failed");
            toast.error("Failed to load tables");
        } finally {
            setIsLoading(false);
        }
    }, [sourceId, database]);

    useEffect(() => {
        fetchTables();
    }, [fetchTables]);

    const hasSize = tables.some(t => t.sizeInBytes != null);
    const totalRows = tables.reduce((s, t) => s + (t.rowCount ?? 0), 0);

    return (
        <Card>
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Database className="h-4 w-4 text-muted-foreground" />
                            {database}
                        </CardTitle>
                        <CardDescription>
                            {isLoading
                                ? "Loading tables..."
                                : `${tables.length} object${tables.length !== 1 ? "s" : ""}${totalRows > 0 ? ` · ~${totalRows.toLocaleString()} rows` : ""}`}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="flex items-center gap-4">
                                <Skeleton className="h-5 w-40" />
                                <Skeleton className="h-5 w-16 ml-auto" />
                                <Skeleton className="h-5 w-20" />
                            </div>
                        ))}
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-3 text-destructive py-4">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <div>
                            <p className="font-medium">Failed to load tables</p>
                            <p className="text-sm text-muted-foreground">{error}</p>
                        </div>
                    </div>
                ) : tables.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <TableIcon className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No tables found in this database.</p>
                    </div>
                ) : (
                    <div className="border rounded-md overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-transparent">
                                    <TableHead>Name</TableHead>
                                    <TableHead className="w-28">Type</TableHead>
                                    <TableHead className="text-right w-32">Rows</TableHead>
                                    {hasSize && <TableHead className="text-right w-28">Size</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {tables.map(table => {
                                    const typeMeta = TYPE_BADGE[table.type ?? "table"] ?? TYPE_BADGE.table;
                                    return (
                                        <TableRow
                                            key={table.name}
                                            className="cursor-pointer hover:bg-accent/50"
                                            onClick={() => onTableClick(table.name)}
                                        >
                                            <TableCell className="font-medium">
                                                <span className="flex items-center gap-2">
                                                    <TableIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                                                    {table.name}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={typeMeta.variant} className="text-xs">
                                                    {typeMeta.label}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right text-muted-foreground">
                                                <span className="flex items-center justify-end gap-1.5">
                                                    <Rows3 className="h-3.5 w-3.5" />
                                                    {table.rowCount != null ? table.rowCount.toLocaleString() : "-"}
                                                </span>
                                            </TableCell>
                                            {hasSize && (
                                                <TableCell className="text-right text-muted-foreground">
                                                    {table.sizeInBytes != null ? formatBytes(table.sizeInBytes) : "-"}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
