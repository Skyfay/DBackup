"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Database, RefreshCw, HardDrive, TableIcon, AlertTriangle, Server } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/utils";
import { AdapterIcon } from "@/components/adapter/adapter-icon";

interface DatabaseInfo {
    name: string;
    sizeInBytes?: number;
    tableCount?: number;
}

interface SourceOption {
    id: string;
    name: string;
    adapterId: string;
}

interface DatabaseExplorerProps {
    sources: SourceOption[];
}

export function DatabaseExplorer({ sources }: DatabaseExplorerProps) {
    const [selectedSource, setSelectedSource] = useState<string>("");
    const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [serverVersion, setServerVersion] = useState<string | null>(null);

    const selectedAdapter = sources.find((s) => s.id === selectedSource);

    const fetchDatabases = useCallback(async (sourceId: string) => {
        setIsLoading(true);
        setError(null);
        setDatabases([]);
        setServerVersion(null);

        // Fetch version in parallel with stats
        const versionPromise = fetch("/api/adapters/test-connection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ configId: sourceId }),
        }).then((r) => r.json()).catch(() => null);

        const statsPromise = fetch("/api/adapters/database-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId }),
        }).then((r) => r.json());

        try {
            const [versionData, statsData] = await Promise.all([versionPromise, statsPromise]);

            if (versionData?.version) {
                setServerVersion(versionData.version);
            }

            if (statsData.success && statsData.databases) {
                setDatabases(statsData.databases);
            } else {
                setError(statsData.message || "Failed to load databases");
                toast.error(statsData.message || "Failed to load databases");
            }
        } catch {
            setError("Connection failed");
            toast.error("Failed to connect to database server");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleSourceChange = (sourceId: string) => {
        setSelectedSource(sourceId);
        if (sourceId) {
            fetchDatabases(sourceId);
        } else {
            setDatabases([]);
            setError(null);
            setServerVersion(null);
        }
    };

    const handleRefresh = () => {
        if (selectedSource) {
            fetchDatabases(selectedSource);
        }
    };

    const totalSize = databases.reduce((sum, db) => sum + (db.sizeInBytes ?? 0), 0);
    const totalTables = databases.reduce((sum, db) => sum + (db.tableCount ?? 0), 0);
    const hasStats = databases.some((db) => db.sizeInBytes != null);

    // Find the largest database for the progress bar scaling
    const maxSize = Math.max(...databases.map((db) => db.sizeInBytes ?? 0), 1);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Database Explorer</h2>
                <p className="text-muted-foreground">
                    Inspect databases on your configured sources — view sizes, table counts, and server details.
                </p>
            </div>

            {/* Source Selector */}
            <Card>
                <CardHeader className="pb-4">
                    <CardTitle className="text-base">Select Source</CardTitle>
                    <CardDescription>Choose a configured database source to inspect.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-3">
                        <Select value={selectedSource} onValueChange={handleSourceChange}>
                            <SelectTrigger className="w-full max-w-md">
                                <SelectValue placeholder="Select a database source..." />
                            </SelectTrigger>
                            <SelectContent>
                                {sources.map((source) => (
                                    <SelectItem key={source.id} value={source.id}>
                                        <span className="flex items-center gap-2">
                                            <AdapterIcon adapterId={source.adapterId} className="h-4 w-4" />
                                            {source.name}
                                            <span className="text-xs text-muted-foreground">({source.adapterId})</span>
                                        </span>
                                    </SelectItem>
                                ))}
                                {sources.length === 0 && (
                                    <SelectItem value="_empty" disabled>
                                        No database sources configured
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                        {selectedSource && (
                            <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isLoading}>
                                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Server Info + Stats Summary */}
            {selectedSource && !error && (databases.length > 0 || isLoading) && (
                <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-md bg-primary/10">
                                    <Server className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Server</p>
                                    {isLoading ? (
                                        <Skeleton className="h-5 w-24 mt-1" />
                                    ) : (
                                        <p className="text-lg font-semibold">
                                            {selectedAdapter?.adapterId ?? "—"}
                                            {serverVersion && (
                                                <span className="text-sm font-normal text-muted-foreground ml-2">v{serverVersion}</span>
                                            )}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-md bg-blue-500/10">
                                    <Database className="h-5 w-5 text-blue-500" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Databases</p>
                                    {isLoading ? (
                                        <Skeleton className="h-5 w-12 mt-1" />
                                    ) : (
                                        <p className="text-lg font-semibold">{databases.length}</p>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-md bg-emerald-500/10">
                                    <HardDrive className="h-5 w-5 text-emerald-500" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Total Size</p>
                                    {isLoading ? (
                                        <Skeleton className="h-5 w-20 mt-1" />
                                    ) : (
                                        <p className="text-lg font-semibold">
                                            {hasStats ? formatBytes(totalSize) : "—"}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Error State */}
            {error && (
                <Card className="border-destructive/50">
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            <div>
                                <p className="font-medium">Connection Failed</p>
                                <p className="text-sm text-muted-foreground">{error}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Database Table */}
            {selectedSource && !error && (
                <Card>
                    <CardHeader className="pb-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base">Databases</CardTitle>
                                <CardDescription>
                                    {isLoading
                                        ? "Loading databases..."
                                        : `${databases.length} database${databases.length !== 1 ? "s" : ""} found${hasStats ? ` · ${formatBytes(totalSize)} total · ${totalTables} tables` : ""}`}
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="space-y-3">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="flex items-center gap-4">
                                        <Skeleton className="h-5 w-32" />
                                        <Skeleton className="h-5 w-20 ml-auto" />
                                        <Skeleton className="h-5 w-16" />
                                        <Skeleton className="h-4 w-32" />
                                    </div>
                                ))}
                            </div>
                        ) : databases.length > 0 ? (
                            <div className="border rounded-md overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead>Name</TableHead>
                                            <TableHead className="text-right w-28">Size</TableHead>
                                            <TableHead className="text-right w-24">Tables</TableHead>
                                            {hasStats && <TableHead className="w-48">Size Distribution</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {databases
                                            .sort((a, b) => (b.sizeInBytes ?? 0) - (a.sizeInBytes ?? 0))
                                            .map((db) => {
                                                const sizePercent = maxSize > 0 ? ((db.sizeInBytes ?? 0) / maxSize) * 100 : 0;
                                                return (
                                                    <TableRow key={db.name}>
                                                        <TableCell className="font-medium">
                                                            <span className="flex items-center gap-2">
                                                                <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                                                                {db.name}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell className="text-right text-muted-foreground">
                                                            {db.sizeInBytes != null ? formatBytes(db.sizeInBytes) : "—"}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {db.tableCount != null ? (
                                                                <span className="flex items-center justify-end gap-1.5 text-muted-foreground">
                                                                    <TableIcon className="h-3.5 w-3.5" />
                                                                    {db.tableCount}
                                                                </span>
                                                            ) : (
                                                                "—"
                                                            )}
                                                        </TableCell>
                                                        {hasStats && (
                                                            <TableCell>
                                                                <Progress value={sizePercent} className="h-2" />
                                                            </TableCell>
                                                        )}
                                                    </TableRow>
                                                );
                                            })}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">
                                <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">No user databases found on this server.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Empty State (no source selected) */}
            {!selectedSource && (
                <Card>
                    <CardContent className="py-16">
                        <div className="text-center text-muted-foreground">
                            <Database className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p className="text-lg font-medium">Select a database source</p>
                            <p className="text-sm mt-1">Choose a source above to explore its databases.</p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
