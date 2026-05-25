"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { DatabaseTableList } from "./database-table-list";
import { DatabaseTableData } from "./database-table-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
    Database,
    RefreshCw,
    HardDrive,
    TableIcon,
    AlertTriangle,
    Server,
    ChevronsUpDown,
    ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialSourceId = searchParams.get("sourceId") ?? "";
    const initialDatabase = searchParams.get("database") ?? "";
    const initialTable = searchParams.get("table") ?? "";

    const [selectedSource, setSelectedSource] = useState<string>(initialSourceId);
    const [selectedDatabase, setSelectedDatabase] = useState<string>(initialDatabase);
    const [selectedTable, setSelectedTable] = useState<string>(initialTable);
    const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [serverVersion, setServerVersion] = useState<string | null>(null);
    const [comboboxOpen, setComboboxOpen] = useState(false);
    const [hasAutoLoaded, setHasAutoLoaded] = useState(false);
    const [activeTab, setActiveTab] = useState<string>(initialDatabase ? "databases" : "general");

    const selectedAdapter = sources.find((s) => s.id === selectedSource);

    const buildUrl = (sourceId: string, database?: string, table?: string) => {
        const params = new URLSearchParams();
        if (sourceId) params.set("sourceId", sourceId);
        if (database) params.set("database", database);
        if (table) params.set("table", table);
        return `?${params.toString()}`;
    };

    const handleDatabaseClick = (dbName: string) => {
        setSelectedDatabase(dbName);
        setSelectedTable("");
        router.push(buildUrl(selectedSource, dbName));
    };

    const handleTableClick = (tableName: string) => {
        setSelectedTable(tableName);
        router.push(buildUrl(selectedSource, selectedDatabase, tableName));
    };

    const handleBackToDbList = () => {
        setSelectedDatabase("");
        setSelectedTable("");
        router.push(buildUrl(selectedSource));
    };

    const handleBackToTableList = () => {
        setSelectedTable("");
        router.push(buildUrl(selectedSource, selectedDatabase));
    };

    const fetchDatabases = useCallback(async (sourceId: string) => {
        setIsLoading(true);
        setError(null);
        setDatabases([]);
        setServerVersion(null);

        try {
            const res = await fetch("/api/adapters/database-stats", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceId }),
            });
            const statsData = await res.json();

            if (statsData.serverVersion) {
                setServerVersion(statsData.serverVersion);
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

    // Auto-load if sourceId is in URL
    useEffect(() => {
        if (initialSourceId && !hasAutoLoaded && sources.some((s) => s.id === initialSourceId)) {
            setHasAutoLoaded(true);
            fetchDatabases(initialSourceId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSourceId, hasAutoLoaded, sources]);

    const handleSourceChange = (sourceId: string) => {
        setSelectedSource(sourceId);
        setSelectedDatabase("");
        setSelectedTable("");
        setActiveTab("general");
        if (sourceId) {
            fetchDatabases(sourceId);
            router.replace(buildUrl(sourceId));
        } else {
            setDatabases([]);
            setError(null);
            setServerVersion(null);
            router.replace("?");
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
    const maxSize = Math.max(...databases.map((db) => db.sizeInBytes ?? 0), 1);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Database Explorer</h2>
                <p className="text-muted-foreground">
                    Inspect and browse databases on your configured sources.
                </p>
            </div>

            {/* Source Selector + Refresh */}
            <div className="flex items-center gap-3">
                <div className="w-75">
                    <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={comboboxOpen}
                                className="w-full justify-between"
                            >
                                {selectedAdapter ? (
                                    <span className="flex items-center gap-2">
                                        <AdapterIcon adapterId={selectedAdapter.adapterId} className="h-4 w-4" />
                                        {selectedAdapter.name}
                                        <span className="text-xs text-muted-foreground">({selectedAdapter.adapterId})</span>
                                    </span>
                                ) : (
                                    "Select Source..."
                                )}
                                <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-75 p-0">
                            <Command>
                                <CommandInput placeholder="Search sources..." />
                                <CommandList>
                                    <CommandEmpty>No source found.</CommandEmpty>
                                    <CommandGroup>
                                        {sources.map((source) => (
                                            <CommandItem
                                                key={source.id}
                                                value={`${source.name} ${source.adapterId}`}
                                                onSelect={() => {
                                                    handleSourceChange(source.id === selectedSource ? "" : source.id);
                                                    setComboboxOpen(false);
                                                }}
                                                className={cn(selectedSource === source.id && "bg-accent")}
                                            >
                                                <AdapterIcon adapterId={source.adapterId} className="h-4 w-4" />
                                                {source.name}
                                                <span className="text-xs text-muted-foreground ml-1">({source.adapterId})</span>
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>
                {selectedSource && (
                    <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isLoading}>
                        <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                    </Button>
                )}
            </div>

            {/* Tabs - only rendered when a source is selected */}
            {selectedSource && (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="general">General</TabsTrigger>
                        <TabsTrigger value="databases">Databases</TabsTrigger>
                    </TabsList>

                    {/* GENERAL TAB */}
                    <TabsContent value="general" className="mt-4">
                        {error ? (
                            <Card className="border-destructive/50">
                                <CardContent className="py-6">
                                    <div className="flex items-center gap-3 text-destructive">
                                        <AlertTriangle className="h-5 w-5 shrink-0" />
                                        <div>
                                            <p className="font-medium">Connection Failed</p>
                                            <p className="text-sm text-muted-foreground">{error}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-3">
                                <Card>
                                    <CardContent className="py-4">
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
                                                        {selectedAdapter?.adapterId ?? "-"}
                                                        {serverVersion && (
                                                            <span className="text-sm font-normal text-muted-foreground ml-2">
                                                                v{serverVersion}
                                                            </span>
                                                        )}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardContent className="py-4">
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
                                    <CardContent className="py-4">
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
                                                        {hasStats ? formatBytes(totalSize) : "-"}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {(isLoading || (hasStats && totalTables > 0)) && (
                                    <Card className="md:col-span-3">
                                        <CardContent className="py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-md bg-orange-500/10">
                                                    <TableIcon className="h-5 w-5 text-orange-500" />
                                                </div>
                                                <div>
                                                    <p className="text-sm text-muted-foreground">Total Tables</p>
                                                    {isLoading ? (
                                                        <Skeleton className="h-5 w-12 mt-1" />
                                                    ) : (
                                                        <p className="text-lg font-semibold">{totalTables}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    {/* DATABASES TAB */}
                    <TabsContent value="databases" className="mt-4">
                        {/* Breadcrumb when drilled down */}
                        {selectedDatabase && (
                            <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
                                <button
                                    className="hover:text-foreground transition-colors"
                                    onClick={handleBackToDbList}
                                >
                                    {selectedAdapter?.name ?? selectedSource}
                                </button>
                                <ChevronRight className="h-3.5 w-3.5" />
                                {selectedTable ? (
                                    <>
                                        <button
                                            className="hover:text-foreground transition-colors"
                                            onClick={handleBackToTableList}
                                        >
                                            {selectedDatabase}
                                        </button>
                                        <ChevronRight className="h-3.5 w-3.5" />
                                        <span className="text-foreground font-medium">{selectedTable}</span>
                                    </>
                                ) : (
                                    <span className="text-foreground font-medium">{selectedDatabase}</span>
                                )}
                            </nav>
                        )}

                        {/* Data viewer */}
                        {selectedTable && selectedAdapter ? (
                            <DatabaseTableData
                                sourceId={selectedSource}
                                database={selectedDatabase}
                                table={selectedTable}
                                adapterId={selectedAdapter.adapterId}
                            />
                        ) : selectedDatabase ? (
                            <DatabaseTableList
                                sourceId={selectedSource}
                                database={selectedDatabase}
                                onTableClick={handleTableClick}
                            />
                        ) : (
                            <Card>
                                <CardHeader className="pb-4">
                                    <CardTitle className="text-base">Databases</CardTitle>
                                    <CardDescription>
                                        {isLoading
                                            ? "Loading databases..."
                                            : `${databases.length} database${databases.length !== 1 ? "s" : ""} found${
                                                  hasStats
                                                      ? ` - ${formatBytes(totalSize)} total - ${totalTables} tables`
                                                      : ""
                                              }`}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {isLoading ? (
                                        <div className="space-y-3">
                                            {[...Array(5)].map((_, i) => (
                                                <div key={i} className="flex items-center gap-4">
                                                    <Skeleton className="h-5 w-32" />
                                                    <Skeleton className="h-5 w-20 ml-auto" />
                                                    <Skeleton className="h-5 w-16" />
                                                    <Skeleton className="h-4 w-32" />
                                                </div>
                                            ))}
                                        </div>
                                    ) : error ? (
                                        <div className="flex items-center gap-3 text-destructive py-4">
                                            <AlertTriangle className="h-5 w-5 shrink-0" />
                                            <div>
                                                <p className="font-medium">Connection Failed</p>
                                                <p className="text-sm text-muted-foreground">{error}</p>
                                            </div>
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
                                                            const sizePercent =
                                                                maxSize > 0
                                                                    ? ((db.sizeInBytes ?? 0) / maxSize) * 100
                                                                    : 0;
                                                            return (
                                                                <TableRow
                                                                    key={db.name}
                                                                    className="cursor-pointer hover:bg-accent/50"
                                                                    onClick={() => handleDatabaseClick(db.name)}
                                                                >
                                                                    <TableCell className="font-medium">
                                                                        <span className="flex items-center gap-2">
                                                                            <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                                                                            {db.name}
                                                                        </span>
                                                                    </TableCell>
                                                                    <TableCell className="text-right text-muted-foreground">
                                                                        {db.sizeInBytes != null
                                                                            ? formatBytes(db.sizeInBytes)
                                                                            : "-"}
                                                                    </TableCell>
                                                                    <TableCell className="text-right">
                                                                        {db.tableCount != null ? (
                                                                            <span className="flex items-center justify-end gap-1.5 text-muted-foreground">
                                                                                <TableIcon className="h-3.5 w-3.5" />
                                                                                {db.tableCount}
                                                                            </span>
                                                                        ) : (
                                                                            "-"
                                                                        )}
                                                                    </TableCell>
                                                                    {hasStats && (
                                                                        <TableCell>
                                                                            <Progress
                                                                                value={sizePercent}
                                                                                className="h-2"
                                                                            />
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
                    </TabsContent>
                </Tabs>
            )}

            {/* Empty state */}
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
