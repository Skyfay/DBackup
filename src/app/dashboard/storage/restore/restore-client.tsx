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
import { ArrowRight, ArrowLeft, FileIcon, AlertTriangle, ShieldAlert, Loader2, HardDrive, ChevronDown, ChevronUp, Server, ShieldCheck, HelpCircle, FolderInput, CheckCircle2, FolderOpen, MapPin, Download, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { FileInfo } from "@/app/dashboard/storage/columns";
import { useRouter, useSearchParams } from "next/navigation";
import { formatBytes, compareVersions, cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DateDisplay } from "@/components/utils/date-display";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { restoreFromStorageAction } from "@/app/actions/backup/config-management";
import { RestoreOptions } from "@/lib/types/config-backup";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RedisRestoreWizard } from "@/components/dashboard/storage/redis-restore-wizard";
import { ArchiveFileTree, ArchiveTreeSelection } from "@/components/dashboard/storage/archive-file-tree";
import { FolderPickerDialog } from "@/components/dashboard/storage/folder-picker-dialog";
import { computeRestoreValidity } from "./restore-validation";

interface DatabaseInfo {
    name: string;
    sizeInBytes?: number;
    tableCount?: number;
    /** Firebird only: filesystem path for this alias. */
    path?: string;
}

interface AdapterConfig {
    id: string;
    name: string;
    adapterId: string;
    metadata?: string;
}

interface DbConfig {
    id: string;
    name: string;
    targetName: string;
    selected: boolean;
}

interface DirectoryAnalysis {
    jobSourceId: string;
    label: string;
    fileCount: number;
    totalSize: number;
    excludePatterns: string[];
    /** Original collection location, when the JobSource still exists. */
    origin?: { configId: string; configName: string; path: string };
}

/** Incremental chain info from the analyze response. */
interface ChainInfo {
    type: 'full' | 'incremental';
    index: number;
    deps: string[];
}

interface DirConfig {
    entryId: string;
    label: string;
    targetConfigId: string;
    targetPath: string;
    selected: boolean;
    /** null = the whole source (default); an array = only these paths. */
    selection: ArchiveTreeSelection;
    /** Whether the file tree is expanded for this source. */
    showTree?: boolean;
    checkStatus?: 'checking' | 'empty' | 'occupied' | 'unverified';
}

/** Result of the server-side dry run over the current directory selection. */
interface RestorePlan {
    fileCount: number;
    totalBytes: number;
    fullDownload: boolean;
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
    const [restoreMode, setRestoreMode] = useState<'overwrite' | 'rename'>('overwrite');

    // Advanced Restore State
    const [analyzedDbs, setAnalyzedDbs] = useState<string[]>([]);
    const [dbConfig, setDbConfig] = useState<DbConfig[]>([]);
    const [backupSourceType, setBackupSourceType] = useState<string>("");

    // Directory Restore State (combined manifest v2 archives)
    const [directories, setDirectories] = useState<DirectoryAnalysis[]>([]);
    const [dirConfig, setDirConfig] = useState<DirConfig[]>([]);
    const [storageDestinations, setStorageDestinations] = useState<AdapterConfig[]>([]);
    const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null);
    const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null);
    /** Set when the dry run failed, e.g. an incremental chain with a missing archive. */
    const [planError, setPlanError] = useState<string | null>(null);
    /** Which source's folder picker dialog is open, if any. */
    const [folderPickerFor, setFolderPickerFor] = useState<string | null>(null);

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

    const SERVER_ADAPTERS = ['mysql', 'mariadb', 'postgres', 'mongodb', 'mssql', 'redis', 'valkey', 'firebird'];
    const resolvedSourceType = backupSourceType || file?.sourceType || '';
    const isServerAdapter = SERVER_ADAPTERS.includes(resolvedSourceType.toLowerCase());
    // Firebird's target field holds a filesystem path, not a database name - and since
    // Firebird has no way to list existing databases, the Overwrite/New badge is replaced
    // with a neutral "Unverified" indicator for this adapter.
    const isFirebird = resolvedSourceType.toLowerCase() === 'firebird';
    // Combined (manifest v2) archive with no database source at all - the "Target Database"
    // section is meaningless for these and is hidden entirely.
    const isDirectoryOnly = resolvedSourceType.toLowerCase() === 'directory-only';
    const hasDirectories = directories.length > 0;

    // Restore validity - the rules live in restore-validation.ts so they are testable.
    // A database target server is only required when at least one database is actually
    // selected; restoring only directories out of a DB+directory backup is a first-class
    // case.
    const validity = computeRestoreValidity({
        dbSelections: dbConfig,
        dirSelections: dirConfig,
        hasDirectories,
        analyzedDbCount: analyzedDbs.length,
        isDirectoryOnly,
        targetSourceId: targetSource,
        planError,
    });
    const { dbTargetNeeded } = validity;

    const [restoreOptions, setRestoreOptions] = useState<RestoreOptions>({
        settings: true,
        adapters: true,
        jobs: true,
        users: true,
        sso: true,
        profiles: true,
        statistics: false
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

    // Fetch storage destinations (restore targets for directory entries)
    useEffect(() => {
        const fetchDestinations = async () => {
            try {
                const res = await fetch("/api/adapters?type=storage");
                if (res.ok) {
                    setStorageDestinations(await res.json());
                }
            } catch {
                // Non-critical
            }
        };
        fetchDestinations();
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

                // Firebird: the target field holds a path, not an alias name - prefill it
                // with the real path of the matching alias once we know it (skip rows the
                // user already edited away from the default name).
                if (isFirebird) {
                    setDbConfig(prev => prev.map(db => {
                        if (db.targetName !== db.name) return db;
                        const match = (data.databases as DatabaseInfo[]).find(d => d.name === db.name);
                        return match?.path ? { ...db, targetName: match.path } : db;
                    }));
                }
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
    }, [file, isFirebird]);

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
                if (data.sourceType) {
                    setBackupSourceType(data.sourceType);
                }
                if (data.databases && data.databases.length > 0) {
                    setAnalyzedDbs(data.databases);
                    setDbConfig(data.databases.map((db: string) => ({
                        id: db,
                        name: db,
                        targetName: db,
                        selected: true
                    })));
                }
                if (data.directories && data.directories.length > 0) {
                    setDirectories(data.directories);
                    setDirConfig(data.directories.map((d: DirectoryAnalysis) => ({
                        entryId: d.jobSourceId,
                        label: d.label,
                        // Default restore target: the original location when its source
                        // still exists ("put it back"), else the backup's own destination.
                        targetConfigId: d.origin?.configId ?? destinationId,
                        targetPath: d.origin?.path ?? "",
                        selected: true,
                        selection: null,
                    })));
                }
                setChainInfo(data.chain ?? null);
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

    const handleToggleDir = (entryId: string) => {
        setDirConfig(prev => prev.map(d => d.entryId === entryId ? { ...d, selected: !d.selected } : d));
    };

    const handleDirTargetConfigChange = (entryId: string, targetConfigId: string) => {
        setDirConfig(prev => prev.map(d => d.entryId === entryId ? { ...d, targetConfigId, checkStatus: undefined } : d));
    };

    const handleDirTargetPathChange = (entryId: string, targetPath: string) => {
        setDirConfig(prev => prev.map(d => d.entryId === entryId ? { ...d, targetPath, checkStatus: undefined } : d));
    };

    const handleDirSelectionChange = (entryId: string, selection: ArchiveTreeSelection) => {
        setDirConfig(prev => prev.map(d => d.entryId === entryId ? { ...d, selection } : d));
    };

    const handleToggleTree = (entryId: string) => {
        setDirConfig(prev => prev.map(d => d.entryId === entryId ? { ...d, showTree: !d.showTree } : d));
    };

    const handleUseOrigin = (entryId: string) => {
        const origin = directories.find(d => d.jobSourceId === entryId)?.origin;
        if (!origin) return;
        setDirConfig(prev => prev.map(d => d.entryId === entryId
            ? { ...d, targetConfigId: origin.configId, targetPath: origin.path, checkStatus: undefined }
            : d));
    };

    /** Selections of the currently selected directory sources, in restore-files format. */
    const buildSelections = useCallback(() => {
        return dirConfig
            .filter(d => d.selected && (d.selection === null || d.selection.length > 0))
            .map(d => ({
                src: d.entryId,
                ...(d.selection !== null ? { paths: d.selection } : {}),
            }));
    }, [dirConfig]);

    // Server-side dry run over the current directory selection: resolves file count and
    // byte total, reports whether the destination can serve byte ranges, and surfaces a
    // broken incremental chain (missing archives, by name) before anything is restored.
    useEffect(() => {
        if (!file || !hasDirectories) return;
        const selections = buildSelections();
        if (selections.length === 0) {
            setRestorePlan(null);
            setPlanError(null);
            return;
        }

        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/storage/${destinationId}/restore-files`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file: file.path, selections, target: { kind: 'download' }, dryRun: true }),
                });
                const data = await res.json();
                if (data.success) {
                    setRestorePlan(data.data);
                    setPlanError(null);
                } else {
                    setRestorePlan(null);
                    setPlanError(data.error || 'Could not resolve the selection');
                }
            } catch {
                // Network-level failure: leave the plan empty, do not block the restore.
                setRestorePlan(null);
                setPlanError(null);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [file, hasDirectories, buildSelections, destinationId]);

    const handleDownloadSelection = async () => {
        if (!file) return;
        const selections = buildSelections();
        if (selections.length === 0) return;

        const toastId = toast.loading('Assembling selection...');
        try {
            const res = await fetch(`/api/storage/${destinationId}/restore-files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: file.path, selections, target: { kind: 'download' } }),
            });
            if (!res.ok) {
                const failure = await res.json().catch(() => ({ error: 'Download failed' }));
                throw new Error(failure.error || 'Download failed');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const anchorEl = document.createElement('a');
            anchorEl.href = url;
            anchorEl.download = `${file.name.replace(/\.[^.]+$/, '')}-files.tar.gz`;
            anchorEl.click();
            URL.revokeObjectURL(url);
            toast.success('Download started', { id: toastId });
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : String(e), { id: toastId });
        }
    };

    // Debounced conflict check: does the chosen restore target already contain files?
    useEffect(() => {
        const timers = dirConfig
            .filter(d => d.selected && d.targetConfigId && d.targetPath.trim() && d.checkStatus === undefined)
            .map(d => setTimeout(async () => {
                setDirConfig(prev => prev.map(p => p.entryId === d.entryId ? { ...p, checkStatus: 'checking' } : p));
                try {
                    const res = await fetch(`/api/storage/${d.targetConfigId}/check-path`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: d.targetPath.trim() })
                    });
                    const data = await res.json();
                    setDirConfig(prev => prev.map(p => p.entryId === d.entryId ? { ...p, checkStatus: data.status || 'unverified' } : p));
                } catch {
                    setDirConfig(prev => prev.map(p => p.entryId === d.entryId ? { ...p, checkStatus: 'unverified' } : p));
                }
            }, 500));
        return () => timers.forEach(clearTimeout);
    }, [dirConfig]);

    const handleRestore = async (usePrivileged = false) => {
        if (!file) return;
        if (dbTargetNeeded && !targetSource) return;

        setRestoring(true);
        setRestoreLogs(null);

        try {
            let mapping = undefined;
            if (analyzedDbs.length > 0) {
                // The full list including deselected entries: an entry with selected:false
                // is how the backend knows a database is NOT wanted. Sending only the
                // selected ones would collapse "none selected" into an empty mapping,
                // which the backend treats as "restore everything".
                mapping = dbConfig.map(c => ({ originalName: c.name, targetName: c.targetName, selected: c.selected }));
            }

            let auth = undefined;
            if (usePrivileged) {
                auth = { user: privUser, password: privPass };
            }

            const directoryMapping = hasDirectories
                ? dirConfig.map(d => ({
                    entryId: d.entryId,
                    targetConfigId: d.targetConfigId,
                    targetPath: d.targetPath.trim(),
                    selected: d.selected,
                    // Absent = the whole source; an array = only these paths.
                    ...(d.selection !== null ? { paths: d.selection } : {}),
                }))
                : undefined;

            const payload = {
                file: file.path,
                targetSourceId: targetSource || undefined,
                // Note: restoreMode only gates the non-server-adapter RadioGroup UI (which
                // clears targetDbName on "overwrite"); the server-adapter Input paths set
                // targetDbName directly, so its truthiness alone is the correct signal here.
                targetDatabaseName: targetDbName || undefined,
                databaseMapping: mapping,
                directoryMapping,
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

    // Invalid state - redirect back
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

    const isRedisBackup = ['redis', 'valkey'].includes(file.sourceType?.toLowerCase() ?? '');
    const redisEngineName = file.sourceType?.toLowerCase() === 'valkey' ? 'Valkey' : 'Redis';

    // Redis/Valkey backups use a specialized step-by-step wizard
    if (isRedisBackup) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="icon" onClick={handleCancel} className="h-8 w-8">
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                            <div>
                                <h2 className="text-3xl font-bold tracking-tight">Restore Backup</h2>
                                <p className="text-muted-foreground">{redisEngineName} restore requires manual steps - follow the wizard below.</p>
                            </div>
                        </div>
                    </div>
                </div>

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
                                    <Badge variant="secondary" className="text-xs">
                                        {redisEngineName} {file.engineVersion || ""}
                                    </Badge>
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

                <RedisRestoreWizard
                    file={file}
                    destinationId={destinationId}
                    onCancel={handleCancel}
                    engineName={redisEngineName}
                />
            </div>
        );
    }

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

                    {/* System Config Restore */}
                    {isSystemConfig && !restoreLogs && (
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
                                        { key: 'profiles' as const, label: 'Vault Profiles' },
                                        { key: 'statistics' as const, label: 'Statistics & History' },
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
                    {!isSystemConfig && !isDirectoryOnly && !restoreLogs && (
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
                                                    // Filter out restore-excluded sources
                                                    try {
                                                        if (s.metadata) {
                                                            const meta = JSON.parse(s.metadata);
                                                            if (meta.isRestoreExcluded) return false;
                                                        }
                                                    } catch { }

                                                    // Filter by source type compatibility
                                                    if (!file?.sourceType) return true;
                                                    const type = file.sourceType.toLowerCase();
                                                    const adapter = s.adapterId.toLowerCase();
                                                    if (type === 'mysql' || type === 'mariadb') return adapter === 'mysql' || adapter === 'mariadb';
                                                    return adapter === type;
                                                })
                                                .map(format => (
                                                    <SelectItem key={format.id} value={format.id}>
                                                        <span className="flex items-center gap-2">
                                                            <AdapterIcon adapterId={format.adapterId} className="h-4 w-4" />
                                                            {format.name}
                                                            <span className="text-xs text-muted-foreground">({format.adapterId})</span>
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>

                                    {/* Version Compatibility Check */}
                                    {targetSource && isLoadingTargetDbs && (
                                        <Skeleton className="h-9 w-full rounded-md" />
                                    )}

                                    {targetSource && !isLoadingTargetDbs && targetServerVersion && compatibilityIssues.length === 0 && file?.engineVersion && (
                                        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-green-500/30 bg-green-500/5 text-sm text-green-700 dark:text-green-400">
                                            <ShieldCheck className="h-4 w-4 shrink-0" />
                                            <span>Version compatible - Backup {file.engineVersion} → Target {targetServerVersion}</span>
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
                                                        : isServerAdapter
                                                            ? 'Specify the target database name for the restore.'
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
                                        {(isAnalyzing || isLoadingTargetDbs) ? (
                                            <div className="space-y-3">
                                                <Label className="text-sm font-medium text-muted-foreground">
                                                    {isLoadingTargetDbs ? 'Loading target databases...' : 'Analyzing Backup Content...'}
                                                </Label>
                                                <div className="space-y-2">
                                                    <Skeleton className="h-10 w-full" />
                                                    <Skeleton className="h-10 w-full" />
                                                    <Skeleton className="h-10 w-3/4" />
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
                                                                            className={cn("h-8 text-sm", isFirebird && "font-mono")}
                                                                            placeholder={isFirebird ? "/path/to/database.fdb" : "Target Name"}
                                                                            disabled={!db.selected}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell className="py-2.5 text-center">
                                                                        {!db.selected ? null : isFirebird ? (
                                                                            <TooltipProvider>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger>
                                                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                                                                            <HelpCircle className="h-3 w-3 mr-1" />
                                                                                            Unverified
                                                                                        </Badge>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent>
                                                                                        <p>DBackup cannot check whether a database already exists at this path - Firebird has no way to list databases. Existing files at this path will be overwritten.</p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                        ) : willOverwrite ? (
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
                                                                        ) : (
                                                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                                                New
                                                                            </Badge>
                                                                        )}
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        ) : isServerAdapter ? (
                                            <div className="space-y-3">
                                                <p className="text-sm text-muted-foreground">
                                                    {isFirebird
                                                        ? "The database alias in this backup could not be determined automatically. Leave empty to restore into the original database, or specify a target path."
                                                        : "The database names in this backup could not be determined automatically. Leave empty to restore into the original database, or specify a target name."}
                                                </p>
                                                <div className="space-y-1.5">
                                                    <Label className="text-sm">{isFirebird ? "Target Database Path" : "Target Database Name"}</Label>
                                                    <Input
                                                        placeholder={isFirebird ? "Leave empty for original database, or enter a path..." : "Leave empty for original database..."}
                                                        value={targetDbName}
                                                        onChange={(e) => setTargetDbName(e.target.value)}
                                                        className={cn("h-8", isFirebird && "font-mono")}
                                                    />
                                                    <p className="text-xs text-muted-foreground">
                                                        {isFirebird
                                                            ? "If empty, the backup is restored into its original database. If you enter a path, DBackup cannot verify whether a database already exists there - existing files at that path will be overwritten."
                                                            : "If empty, the backup will be restored into its original database. Existing data will be overwritten."}
                                                    </p>
                                                </div>
                                            </div>
                                        ) : (
                                            <RadioGroup value={restoreMode} onValueChange={(v) => {
                                                const mode = v as 'overwrite' | 'rename';
                                                setRestoreMode(mode);
                                                if (mode === 'overwrite') setTargetDbName('');
                                            }} className="grid grid-cols-1 gap-4">
                                                <div>
                                                    <div className="flex items-center space-x-2">
                                                        <RadioGroupItem value="overwrite" id="r1" />
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
                                                                setRestoreMode('rename');
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

                    {/* Directory Restore */}
                    {hasDirectories && !restoreLogs && (
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <FolderInput className="h-4 w-4" />
                                            Directory Restore
                                        </CardTitle>
                                        <CardDescription>
                                            Select which directory sources to restore and where to write them.
                                        </CardDescription>
                                    </div>
                                    <Badge variant="outline" className="text-xs font-normal">
                                        {dirConfig.filter(d => d.selected).length} of {directories.length} Selected
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {chainInfo && (
                                    <Alert>
                                        <GitBranch className="h-4 w-4" />
                                        <AlertTitle className="text-sm font-semibold ml-2">
                                            {chainInfo.type === 'incremental'
                                                ? `Incremental snapshot (position ${chainInfo.index} in its chain)`
                                                : 'Full backup of an incremental chain'}
                                        </AlertTitle>
                                        {chainInfo.deps.length > 0 && (
                                            <AlertDescription className="text-xs ml-2">
                                                Restoring reads from {chainInfo.deps.length + 1} archives of this chain, automatically.
                                            </AlertDescription>
                                        )}
                                    </Alert>
                                )}
                                {planError && (
                                    <Alert variant="destructive">
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertTitle className="text-sm font-semibold ml-2">Cannot restore this selection</AlertTitle>
                                        <AlertDescription className="text-xs ml-2">{planError}</AlertDescription>
                                    </Alert>
                                )}
                                {dirConfig.map(d => {
                                    const meta = directories.find(x => x.jobSourceId === d.entryId);
                                    return (
                                        <div key={d.entryId} className={cn("border rounded-md p-3 space-y-2", !d.selected && "opacity-50 bg-muted/20")}>
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id={`dir-${d.entryId}`}
                                                    checked={d.selected}
                                                    onCheckedChange={() => handleToggleDir(d.entryId)}
                                                />
                                                <Label htmlFor={`dir-${d.entryId}`} className="cursor-pointer font-medium text-sm flex-1 truncate">
                                                    {d.label}
                                                </Label>
                                                {meta && (
                                                    <span className="text-xs text-muted-foreground shrink-0">
                                                        {meta.fileCount} file{meta.fileCount === 1 ? '' : 's'}, {formatBytes(meta.totalSize)}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 pl-6">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-xs"
                                                    disabled={!d.selected}
                                                    onClick={() => handleToggleTree(d.entryId)}
                                                >
                                                    {d.showTree ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                                                    {d.selection === null
                                                        ? 'All files'
                                                        : `${d.selection.length} path${d.selection.length === 1 ? '' : 's'} selected`}
                                                </Button>
                                                {meta?.origin && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 text-xs text-muted-foreground"
                                                        disabled={!d.selected}
                                                        onClick={() => handleUseOrigin(d.entryId)}
                                                        title={`${meta.origin.configName}:${meta.origin.path}`}
                                                    >
                                                        <MapPin className="h-3.5 w-3.5 mr-1" />
                                                        Use original location
                                                    </Button>
                                                )}
                                            </div>
                                            {d.showTree && d.selected && file && (
                                                <div className="pl-6">
                                                    <ArchiveFileTree
                                                        destinationId={destinationId}
                                                        file={file.path}
                                                        jobSourceId={d.entryId}
                                                        selection={d.selection}
                                                        onSelectionChange={(sel) => handleDirSelectionChange(d.entryId, sel)}
                                                    />
                                                </div>
                                            )}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
                                                <Select
                                                    value={d.targetConfigId}
                                                    onValueChange={(v) => handleDirTargetConfigChange(d.entryId, v)}
                                                    disabled={!d.selected}
                                                >
                                                    <SelectTrigger className="h-8 text-sm">
                                                        <SelectValue placeholder="Target Adapter..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {storageDestinations.map(sd => (
                                                            <SelectItem key={sd.id} value={sd.id}>
                                                                <span className="flex items-center gap-2">
                                                                    <AdapterIcon adapterId={sd.adapterId} className="h-4 w-4" />
                                                                    {sd.name}
                                                                </span>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <div className="flex items-center gap-1.5">
                                                    <Input
                                                        value={d.targetPath}
                                                        onChange={(e) => handleDirTargetPathChange(d.entryId, e.target.value)}
                                                        placeholder="/restore/path"
                                                        className="h-8 text-sm"
                                                        disabled={!d.selected}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-8 w-8 shrink-0"
                                                        disabled={!d.selected || !d.targetConfigId}
                                                        onClick={() => setFolderPickerFor(d.entryId)}
                                                        aria-label="Browse folders"
                                                    >
                                                        <FolderOpen className="h-3.5 w-3.5" />
                                                    </Button>
                                                    {d.selected && d.checkStatus === 'checking' && (
                                                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                                                    )}
                                                    {d.selected && d.checkStatus === 'occupied' && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
                                                                        <AlertTriangle className="h-3 w-3 mr-1" />
                                                                        Occupied
                                                                    </Badge>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>This path already contains files - matching filenames will be overwritten</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                    {d.selected && d.checkStatus === 'empty' && (
                                                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                                                            <CheckCircle2 className="h-3 w-3 mr-1" />
                                                            Empty
                                                        </Badge>
                                                    )}
                                                    {d.selected && d.checkStatus === 'unverified' && (
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger>
                                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground">
                                                                        <HelpCircle className="h-3 w-3 mr-1" />
                                                                        Unverified
                                                                    </Badge>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>DBackup could not check this path in advance - existing files at this path may be overwritten.</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {(restorePlan || dirConfig.some(d => d.selected)) && (
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                                        <div className="space-y-1">
                                            {restorePlan && (
                                                <p className="text-xs text-muted-foreground">
                                                    Selection: {restorePlan.fileCount} file{restorePlan.fileCount === 1 ? '' : 's'}, {formatBytes(restorePlan.totalBytes)}
                                                </p>
                                            )}
                                            {restorePlan?.fullDownload && (
                                                <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    This destination cannot serve byte ranges - the restore transfers the whole archive once.
                                                </p>
                                            )}
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={restoring || !!planError || buildSelections().length === 0}
                                            onClick={handleDownloadSelection}
                                        >
                                            <Download className="h-3.5 w-3.5 mr-1.5" />
                                            Download selection (.tar.gz)
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Folder picker for the directory restore target currently being edited */}
                    {folderPickerFor && (() => {
                        const editing = dirConfig.find(d => d.entryId === folderPickerFor);
                        const targetAdapter = storageDestinations.find(sd => sd.id === editing?.targetConfigId);
                        if (!editing || !targetAdapter) return null;
                        return (
                            <FolderPickerDialog
                                open
                                onOpenChange={(o) => { if (!o) setFolderPickerFor(null); }}
                                configId={targetAdapter.id}
                                configName={targetAdapter.name}
                                onSelect={(path) => handleDirTargetPathChange(editing.entryId, path)}
                            />
                        );
                    })()}

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
                    {!isSystemConfig && targetSource && (isLoadingTargetDbs || targetDatabases.length > 0) && (
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
                                            <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-64">
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
                                                                        {db.sizeInBytes != null ? formatBytes(db.sizeInBytes) : '-'}
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
                                            disabled={restoring || isLoadingTargetDbs || isAnalyzing || !validity.canSubmit || compatibilityIssues.length > 0}
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
