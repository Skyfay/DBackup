"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Database, ArrowRight, ArrowLeft, FileIcon, AlertTriangle, ShieldAlert, Loader2, HardDrive, ChevronDown, ChevronUp, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { FileInfo } from "@/app/dashboard/storage/columns";
import { useRouter, useSearchParams } from "next/navigation";
import { formatBytes, compareVersions } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DateDisplay } from "@/components/utils/date-display";
import { restoreFromStorageAction } from "@/app/actions/config-management";
import { RestoreOptions } from "@/lib/types/config-backup";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DatabaseInfo {
    name: string;
    sizeInBytes?: number;
    tableCount?: number;
}

interface AdapterConfig {
    id: string;
    name: string;
    adapterId: string;
}

interface DbConfig {
    id: string;
    name: string;
    targetName: string;
    selected: boolean;
}

export function RestoreClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { autoRedirectOnJobStart } = useUserPreferences();

    // Parse file info and destination from URL
    const file = useMemo<FileInfo | null>(() => {
        try {
            const encoded = searchParams.get("file");
            if (!encoded) return null;
            return JSON.parse(atob(encoded));
        } catch {
            return null;
        }
    }, [searchParams]);

    const destinationId = searchParams.get("destinationId") || "";

    // Sources fetched client-side
    const [sources, setSources] = useState<AdapterConfig[]>([]);

    const [targetSource, setTargetSource] = useState<string>("");
    const [targetDbName, setTargetDbName] = useState<string>("");

    // Advanced Restore State
    const [analyzedDbs, setAnalyzedDbs] = useState<string[]>([]);
    const [dbConfig, setDbConfig] = useState<DbConfig[]>([]);

    // Execution State
    const [restoring, setRestoring] = useState(false);
    const [restoreLogs, setRestoreLogs] = useState<string[] | null>(null);

    // Privileged restore state
    const [showPrivileged, setShowPrivileged] = useState(false);
    const [privUser, setPrivUser] = useState("root");
    const [privPass, setPrivPass] = useState("");

    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Target server database stats
    const [targetDatabases, setTargetDatabases] = useState<DatabaseInfo[]>([]);
    const [isLoadingTargetDbs, setIsLoadingTargetDbs] = useState(false);
    const [showTargetDbs, setShowTargetDbs] = useState(false);

    // Compatibility check state
    const [targetServerVersion, setTargetServerVersion] = useState<string | undefined>();
    const [_targetServerEdition, setTargetServerEdition] = useState<string | undefined>();
    const [compatibilityIssues, setCompatibilityIssues] = useState<{ type: 'error' | 'warning'; message: string }[]>([]);

    const isSystemConfig = file?.sourceType === 'SYSTEM';

    const [restoreOptions, setRestoreOptions] = useState<RestoreOptions>({
        settings: true,
        adapters: true,
        jobs: true,
        users: true,
        sso: true,
        profiles: true
    });

    // Fetch database sources
    useEffect(() => {
        const fetchSources = async () => {
            try {
                const res = await fetch("/api/adapters?type=database");
                if (res.ok) {
                    setSources(await res.json());
                }
            } catch {
                // Non-critical
            }
        };
        fetchSources();
    }, []);

    const handleConfigRestore = async () => {
        if (!file) return;
        setRestoring(true);
        try {
            const res = await restoreFromStorageAction(destinationId, file.path, undefined, restoreOptions);
            if (res.success && res.executionId) {
                toast.success("System restore started in background");
                if (autoRedirectOnJobStart) {
                    router.push(`/dashboard/history?executionId=${res.executionId}&autoOpen=true`);
                } else {
                    router.push(`/dashboard/storage?destination=${encodeURIComponent(destinationId)}`);
                }
            } else {
                toast.error(res.error || "Failed to start restore");
            }
        } catch {
            toast.error("Restore failed unexpectedly");
        } finally {
            setRestoring(false);
        }
    };

    // Fetch target server databases when a source is selected
    const fetchTargetDatabases = useCallback(async (sourceId: string) => {
        setIsLoadingTargetDbs(true);
        setTargetDatabases([]);
        setTargetServerVersion(undefined);
        setTargetServerEdition(undefined);
        setCompatibilityIssues([]);
        try {
            const res = await fetch('/api/adapters/database-stats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceId })
            });
            const data = await res.json();
            if (data.success && data.databases) {
                setTargetDatabases(data.databases);
                setShowTargetDbs(true);
            }

            if (data.serverVersion) setTargetServerVersion(data.serverVersion);
            if (data.serverEdition) setTargetServerEdition(data.serverEdition);

            // Run compatibility checks
            if (file && data.serverVersion) {
                const issues: { type: 'error' | 'warning'; message: string }[] = [];

                if (file.engineVersion && compareVersions(file.engineVersion, data.serverVersion) > 0) {
                    issues.push({
                        type: 'warning',
                        message: `Backup was created on version ${file.engineVersion}, but the target server runs ${data.serverVersion}. Restoring a newer backup to an older server can cause incompatibility issues.`
                    });
                }

                if (file.sourceType?.toLowerCase() === 'mssql' && file.engineEdition && data.serverEdition) {
                    const sourceIsEdge = file.engineEdition === 'Azure SQL Edge';
                    const targetIsEdge = data.serverEdition === 'Azure SQL Edge';
                    if (sourceIsEdge !== targetIsEdge) {
                        issues.push({
                            type: 'error',
                            message: `Incompatible MSSQL editions: Backup from "${file.engineEdition}" cannot be restored to "${data.serverEdition}". Azure SQL Edge and SQL Server are not fully compatible.`
                        });
                    }
                }

                setCompatibilityIssues(issues);
            }
        } catch {
            // Non-critical
        } finally {
            setIsLoadingTargetDbs(false);
        }
    }, [file]);

    // Trigger fetch when target source changes
    useEffect(() => {
        if (targetSource) {
            fetchTargetDatabases(targetSource);
        } else {
            setTargetDatabases([]);
            setShowTargetDbs(false);
            setTargetServerVersion(undefined);
            setTargetServerEdition(undefined);
            setCompatibilityIssues([]);
        }
    }, [targetSource, fetchTargetDatabases]);

    const analyzeBackup = useCallback(async (file: FileInfo) => {
        setIsAnalyzing(true);
        try {
            const res = await fetch(`/api/storage/${destinationId}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: file.path, type: file.sourceType })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.databases && data.databases.length > 0) {
                    setAnalyzedDbs(data.databases);
                    setDbConfig(data.databases.map((db: string) => ({
                        id: db,
                        name: db,
                        targetName: db,
                        selected: true
                    })));
                }
            }
        } catch {
            // Analysis failed silently
        } finally {
            setIsAnalyzing(false);
        }
    }, [destinationId]);

    // Analyze backup on mount
    useEffect(() => {
        if (file?.sourceType) {
            analyzeBackup(file);
        }
    }, [file, analyzeBackup]);

    const handleToggleDb = (id: string) => {
        setDbConfig(prev => prev.map(db => db.id === id ? { ...db, selected: !db.selected } : db));
    };

    const handleRenameDb = (id: string, newName: string) => {
        setDbConfig(prev => prev.map(db => db.id === id ? { ...db, targetName: newName } : db));
    };

    const handleRestore = async (usePrivileged = false) => {
        if (!file || !targetSource) return;

        setRestoring(true);
        setRestoreLogs(null);

        try {
            let mapping = undefined;
            if (analyzedDbs.length > 0) {
                mapping = dbConfig
                    .filter(c => c.selected)
                    .map(c => ({ originalName: c.name, targetName: c.targetName, selected: true }));
            }

            let auth = undefined;
            if (usePrivileged) {
                auth = { user: privUser, password: privPass };
            }

            const payload = {
                file: file.path,
                targetSourceId: targetSource,
                targetDatabaseName: targetDbName || undefined,
                databaseMapping: mapping,
                privilegedAuth: auth
            };

            const res = await fetch(`/api/storage/${destinationId}/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok && data.success) {
                toast.success("Restore started in background");
                if (autoRedirectOnJobStart) {
                    router.push(`/dashboard/history?executionId=${data.executionId}&autoOpen=true`);
                } else {
                    router.push(`/dashboard/storage?destination=${encodeURIComponent(destinationId)}`);
                }
            } else {
                toast.error("Restore request failed");
                const logs = data.logs || [];
                const errorMessage = data.error || "Unknown error";

                if (logs.length > 0) {
                    setRestoreLogs(logs);
                    const logString = logs.join('\n');
                    if (logString.includes("Access denied") || logString.includes("User permissions?")) {
                        setShowPrivileged(true);
                    }
                } else {
                    setRestoreLogs([errorMessage]);
                    if (errorMessage.includes("Access denied") || errorMessage.includes("User permissions?")) {
                        setShowPrivileged(true);
                    }
                }
            }
        } catch {
            toast.error("Restore request failed");
        } finally {
            setRestoring(false);
        }
    };

    const handleCancel = () => {
        router.push(`/dashboard/storage?destination=${encodeURIComponent(destinationId)}`);
    };

    // Invalid state — redirect back
    if (!file || !destinationId) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Restore Backup</h2>
                    <p className="text-muted-foreground">No backup file selected.</p>
                </div>
                <Button variant="outline" onClick={() => router.push("/dashboard/storage")}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Storage Explorer
                </Button>
            </div>
        );
    }

    // Redis backups are not supported on this page (they use their own wizard)
    const isRedisBackup = file.sourceType?.toLowerCase() === 'redis';

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={handleCancel} className="h-8 w-8">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div>
                            <h2 className="text-3xl font-bold tracking-tight">Restore Backup</h2>
                            <p className="text-muted-foreground">Review the details below before starting the recovery process.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Main Restore Config */}
                <div className="lg:col-span-2 space-y-6">
                    {/* File Details Card */}
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-4">
                                <div className="p-2.5 rounded-lg bg-primary/10 border">
                                    <FileIcon className="h-6 w-6 text-primary" />
                                </div>
                                <div className="flex-1 space-y-1.5">
                                    <p className="font-semibold text-lg leading-none">{file.name}</p>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1.5">
                                            <HardDrive className="h-3.5 w-3.5" /> {formatBytes(file.size)}
                                        </span>
                                        <span className="flex items-center">
                                            <DateDisplay date={file.lastModified} className="text-sm" />
                                        </span>
                                        {file.sourceType && (
                                            <Badge variant="secondary" className="text-xs">
                                                {file.sourceType} {file.engineVersion}{file.engineEdition ? ` (${file.engineEdition})` : ''}
                                            </Badge>
                                        )}
                                        {file.compression && (
                                            <Badge variant="outline" className="text-xs">{file.compression}</Badge>
                                        )}
                                        {file.isEncrypted && (
                                            <Badge variant="outline" className="text-xs">Encrypted</Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Redis not supported on page — fallback message */}
                    {isRedisBackup && (
                        <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Redis Restore</AlertTitle>
                            <AlertDescription>
                                Redis restores use a specialized wizard. Please use the restore button in the Storage Explorer.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* System Config Restore */}
                    {!isRedisBackup && isSystemConfig && !restoreLogs && (
                        <Card>
                            <CardHeader>
                                <CardTitle>System Restore</CardTitle>
                                <CardDescription>Select which components to restore from this system backup.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Warning: System Overwrite</AlertTitle>
                                    <AlertDescription>
                                        This action will overwrite your current System Settings, Adapters, Jobs, and Users with the data from the backup.
                                        Existing data will be lost. This cannot be undone.
                                    </AlertDescription>
                                </Alert>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 border rounded-md bg-muted/20">
                                    {([
                                        { key: 'settings' as const, label: 'System Settings' },
                                        { key: 'adapters' as const, label: 'Adapter Configs' },
                                        { key: 'jobs' as const, label: 'Jobs & Schedules' },
                                        { key: 'users' as const, label: 'Users & Groups' },
                                        { key: 'sso' as const, label: 'SSO Providers' },
                                        { key: 'profiles' as const, label: 'Encryption Profiles' },
                                    ]).map(opt => (
                                        <div key={opt.key} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`opt-${opt.key}`}
                                                checked={restoreOptions[opt.key]}
                                                onCheckedChange={(c) => setRestoreOptions(p => ({ ...p, [opt.key]: !!c }))}
                                            />
                                            <label htmlFor={`opt-${opt.key}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                                {opt.label}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Database Restore */}
                    {!isRedisBackup && !isSystemConfig && !restoreLogs && (
                        <>
                            {/* Target Selection Card */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Target Database</CardTitle>
                                    <CardDescription>Select the database source to restore this backup to.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <Select value={targetSource} onValueChange={setTargetSource}>
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Select Database Source..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {sources
                                                .filter(s => {
                                                    if (!file?.sourceType) return true;
                                                    const type = file.sourceType.toLowerCase();
                                                    const adapter = s.adapterId.toLowerCase();
                                                    if (type === 'mysql' || type === 'mariadb') return adapter === 'mysql' || adapter === 'mariadb';
                                                    return adapter === type;
                                                })
                                                .map(format => (
                                                    <SelectItem key={format.id} value={format.id}>
                                                        <span className="flex items-center gap-2">
                                                            <Database className="h-4 w-4 text-muted-foreground" />
                                                            {format.name}
                                                            <span className="text-xs text-muted-foreground">({format.adapterId})</span>
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>

                                    {/* Version Compatibility Check */}
                                    {targetSource && !isLoadingTargetDbs && targetServerVersion && compatibilityIssues.length === 0 && file?.engineVersion && (
                                        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-green-500/30 bg-green-500/5 text-sm text-green-700 dark:text-green-400">
                                            <ShieldCheck className="h-4 w-4 shrink-0" />
                                            <span>Version compatible — Backup {file.engineVersion} → Target {targetServerVersion}</span>
                                        </div>
                                    )}

                                    {targetSource && !isLoadingTargetDbs && compatibilityIssues.length > 0 && (
                                        <div className="space-y-2">
                                            {compatibilityIssues.map((issue, i) => (
                                                <Alert key={i} variant={issue.type === 'error' ? 'destructive' : 'default'}
                                                    className={issue.type === 'warning' ? 'border-orange-500/50 bg-orange-500/5 text-orange-700 dark:text-orange-400 [&>svg]:text-orange-500' : ''}>
                                                    <AlertTriangle className="h-4 w-4" />
                                                    <AlertTitle className="text-sm font-semibold">
                                                        {issue.type === 'error' ? 'Incompatible' : 'Version Mismatch'}
                                                    </AlertTitle>
                                                    <AlertDescription className="text-xs">
                                                        {issue.message}
                                                    </AlertDescription>
                                                </Alert>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Database Mapping Card */}
                            {targetSource && (
                                <Card>
                                    <CardHeader>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <CardTitle>
                                                    {analyzedDbs.length > 0 ? 'Database Mapping' : 'Restore Configuration'}
                                                </CardTitle>
                                                <CardDescription>
                                                    {analyzedDbs.length > 0
                                                        ? 'Select which databases to restore and configure target names.'
                                                        : 'Choose how to restore this backup.'}
                                                </CardDescription>
                                            </div>
                                            {analyzedDbs.length > 0 && (
                                                <Badge variant="outline" className="text-xs font-normal">
                                                    {dbConfig.filter(d => d.selected).length} of {analyzedDbs.length} Selected
                                                </Badge>
                                            )}
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        {isAnalyzing ? (
                                            <div className="space-y-3">
                                                <Label className="text-sm font-medium">Analyzing Backup Content...</Label>
                                                <div className="space-y-2">
                                                    <Skeleton className="h-10 w-full" />
                                                    <Skeleton className="h-10 w-full" />
                                                </div>
                                            </div>
                                        ) : analyzedDbs.length > 0 ? (
                                            <div className="border rounded-md overflow-hidden">
                                                <Table>
                                                    <TableHeader className="bg-muted/50">
                                                        <TableRow className="hover:bg-transparent border-b text-xs uppercase tracking-wider">
                                                            <TableHead className="w-10"></TableHead>
                                                            <TableHead>Source DB</TableHead>
                                                            <TableHead className="w-8"></TableHead>
                                                            <TableHead>Target DB Name</TableHead>
                                                            <TableHead className="w-24 text-center">Status</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {dbConfig.map(db => {
                                                            const willOverwrite = targetDatabases.some(tdb => tdb.name === db.targetName);
                                                            return (
                                                                <TableRow key={db.id} className={!db.selected ? 'opacity-50 bg-muted/20' : ''}>
                                                                    <TableCell className="py-2.5">
                                                                        <Checkbox
                                                                            id={`chk-${db.id}`}
                                                                            checked={db.selected}
                                                                            onCheckedChange={() => handleToggleDb(db.id)}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="py-2.5 font-medium">
                                                                        <Label htmlFor={`chk-${db.id}`} className="cursor-pointer">{db.name}</Label>
                                                                    </TableCell>
                                                                    <TableCell className="py-2.5">
                                                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                                                    </TableCell>
                                                                    <TableCell className="py-2.5">
                                                                        <Input
                                                                            value={db.targetName}
                                                                            onChange={(e) => handleRenameDb(db.id, e.target.value)}
                                                                            className="h-8 text-sm"
                                                                            placeholder="Target Name"
                                                                            disabled={!db.selected}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="py-2.5 text-center">
                                                                        {db.selected && willOverwrite ? (
                                                                            <TooltipProvider>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger>
                                                                                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                                                                            <AlertTriangle className="h-3 w-3 mr-1" />
                                                                                            Overwrite
                                                                                        </Badge>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent>
                                                                                        <p>Database &quot;{db.targetName}&quot; exists on target and will be overwritten</p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                        ) : db.selected ? (
                                                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                                                New
                                                                            </Badge>
                                                                        ) : null}
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        ) : (
                                            <RadioGroup defaultValue="overwrite" className="grid grid-cols-1 gap-4">
                                                <div>
                                                    <div className="flex items-center space-x-2">
                                                        <RadioGroupItem value="overwrite" id="r1" onClick={() => setTargetDbName("")} />
                                                        <Label htmlFor="r1">Overwrite Existing</Label>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground pl-6 mt-1">
                                                        Restores into the default/original database. Existing data will be lost.
                                                    </p>
                                                </div>
                                                <div>
                                                    <div className="flex items-center space-x-2">
                                                        <RadioGroupItem value="rename" id="r2" />
                                                        <Label htmlFor="r2">Restore as New Database</Label>
                                                    </div>
                                                    <div className="pl-6 mt-2">
                                                        <Input
                                                            placeholder="Enter new database name..."
                                                            value={targetDbName}
                                                            onChange={(e) => {
                                                                setTargetDbName(e.target.value);
                                                                const radio = document.getElementById('r2') as HTMLInputElement;
                                                                if (radio) radio.checked = true;
                                                            }}
                                                            className="h-8"
                                                        />
                                                    </div>
                                                </div>
                                            </RadioGroup>
                                        )}
                                    </CardContent>
                                </Card>
                            )}
                        </>
                    )}

                    {/* Restore Failed Logs */}
                    {restoreLogs && (
                        <Card className="border-destructive/50">
                            <CardContent className="pt-6 space-y-4">
                                <div className="bg-destructive/10 p-4 rounded-md border border-destructive/20 space-y-2">
                                    <div className="flex items-center gap-2 text-destructive font-medium">
                                        <AlertTriangle className="h-4 w-4" />
                                        Restore Failed
                                    </div>
                                    <div className="text-xs font-mono bg-background/50 p-3 rounded border overflow-x-auto max-h-60">
                                        {restoreLogs.map((l, i) => (
                                            <div key={i}>{l}</div>
                                        ))}
                                    </div>
                                </div>

                                {showPrivileged && (
                                    <div className="space-y-3 border p-4 rounded-md bg-accent/20">
                                        <div className="flex items-center gap-2">
                                            <ShieldAlert className="h-4 w-4 text-orange-500" />
                                            <h4 className="font-semibold text-sm">Privileged Access Required</h4>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            The restore process needs higher privileges (e.g. to create databases).
                                            Please provide root/admin credentials for the target server.
                                        </p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">User</Label>
                                                <Input value={privUser} onChange={e => setPrivUser(e.target.value)} className="h-8" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Password</Label>
                                                <Input type="password" value={privPass} onChange={e => setPrivPass(e.target.value)} className="h-8" />
                                            </div>
                                        </div>
                                        <Button onClick={() => handleRestore(true)} disabled={restoring} size="sm" className="w-full">
                                            {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Retry with Admin Auth
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Right Column: Target Server Info + Actions */}
                <div className="space-y-6">
                    {/* Existing Databases on Target */}
                    {!isSystemConfig && !isRedisBackup && targetSource && (isLoadingTargetDbs || targetDatabases.length > 0) && (
                        <Card>
                            <CardHeader className="px-4 py-2.5">
                                <button
                                    type="button"
                                    onClick={() => setShowTargetDbs(!showTargetDbs)}
                                    className="flex items-center justify-between w-full"
                                >
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <Server className="h-4 w-4 text-muted-foreground" />
                                        Existing Databases
                                        {!isLoadingTargetDbs && (
                                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                                {targetDatabases.length}
                                            </Badge>
                                        )}
                                    </CardTitle>
                                    {showTargetDbs ? (
                                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </button>
                            </CardHeader>
                            {showTargetDbs && (
                                <CardContent className="pt-0 px-4 pb-3">
                                    {isLoadingTargetDbs ? (
                                        <div className="space-y-1.5">
                                            <Skeleton className="h-7 w-full" />
                                            <Skeleton className="h-7 w-full" />
                                            <Skeleton className="h-7 w-3/4" />
                                        </div>
                                    ) : (
                                        <div className="border rounded-md overflow-hidden">
                                            <ScrollArea className="max-h-64">
                                                <Table>
                                                    <TableHeader className="bg-muted/50 sticky top-0">
                                                        <TableRow className="hover:bg-transparent border-b text-xs uppercase tracking-wider">
                                                            <TableHead>Database</TableHead>
                                                            <TableHead className="text-right w-20">Size</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {targetDatabases.map(db => {
                                                            const isConflict = analyzedDbs.some(
                                                                backupDb => dbConfig.find(c => c.name === backupDb && c.selected)?.targetName === db.name
                                                            );
                                                            return (
                                                                <TableRow key={db.name} className={isConflict ? 'bg-destructive/5' : ''}>
                                                                    <TableCell className="py-1.5 text-sm">
                                                                        <span className="flex items-center gap-2">
                                                                            {db.name}
                                                                            {isConflict && (
                                                                                <TooltipProvider>
                                                                                    <Tooltip>
                                                                                        <TooltipTrigger>
                                                                                            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                                                                                        </TooltipTrigger>
                                                                                        <TooltipContent>
                                                                                            <p>Will be overwritten by restore</p>
                                                                                        </TooltipContent>
                                                                                    </Tooltip>
                                                                                </TooltipProvider>
                                                                            )}
                                                                        </span>
                                                                    </TableCell>
                                                                    <TableCell className="py-1.5 text-sm text-right text-muted-foreground">
                                                                        {db.sizeInBytes != null ? formatBytes(db.sizeInBytes) : '—'}
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </ScrollArea>
                                            {targetDatabases.some(db => db.sizeInBytes != null) && (
                                                <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground flex justify-between">
                                                    <span>{targetDatabases.length} database{targetDatabases.length !== 1 ? 's' : ''}</span>
                                                    <span>{formatBytes(targetDatabases.reduce((sum, db) => sum + (db.sizeInBytes ?? 0), 0))}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            )}
                        </Card>
                    )}

                    {/* Warning + Actions Card */}
                    {!restoreLogs && (
                        <Card>
                            <CardContent className="p-4 space-y-3">
                                <Alert variant="destructive" className="py-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle className="text-sm font-semibold ml-2">Warning</AlertTitle>
                                    <AlertDescription className="text-xs ml-2">
                                        This action is irreversible. Ensure you have a backup of the target if needed.
                                    </AlertDescription>
                                </Alert>

                                <Separator />

                                <div className="flex flex-col gap-2">
                                    {isSystemConfig ? (
                                        <Button
                                            variant="destructive"
                                            onClick={handleConfigRestore}
                                            disabled={restoring}
                                            className="w-full"
                                        >
                                            {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            {restoring ? 'Restoring...' : 'Start System Restore'}
                                        </Button>
                                    ) : (
                                        <Button
                                            onClick={() => handleRestore(false)}
                                            disabled={restoring || !targetSource || (analyzedDbs.length > 0 && !dbConfig.some(d => d.selected)) || compatibilityIssues.length > 0 || isRedisBackup}
                                            className="w-full"
                                        >
                                            {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            {restoring ? 'Starting...' : 'Start Restore'}
                                        </Button>
                                    )}
                                    <Button variant="outline" onClick={handleCancel} disabled={restoring} className="w-full">
                                        Cancel
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Back button when restore failed */}
                    {restoreLogs && !showPrivileged && (
                        <Button variant="outline" onClick={handleCancel} className="w-full">
                            Back to Storage Explorer
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
