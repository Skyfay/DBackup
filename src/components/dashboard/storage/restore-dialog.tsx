"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, ArrowRight, FileIcon, AlertTriangle, ShieldAlert, Loader2, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { FileInfo } from "@/app/dashboard/storage/columns";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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

interface RestoreDialogProps {
    file: FileInfo | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    destinationId: string;
    sources: AdapterConfig[];
    onSuccess: () => void;
}

export function RestoreDialog({ file, open, onOpenChange, destinationId, sources, onSuccess }: RestoreDialogProps) {
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
    const router = useRouter();

    const resetState = useCallback(() => {
        setTargetSource("");
        setTargetDbName("");
        setAnalyzedDbs([]);
        setDbConfig([]);
        setRestoreLogs(null);
        setShowPrivileged(false);
        setPrivPass("");
        setPrivUser("root");
    }, []);

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
                        targetName: db, // Default to same name
                        selected: true
                    })));
                }
            }
        } catch {
            console.error("Analysis failed");
        } finally {
            setIsAnalyzing(false);
        }
    }, [destinationId]);

    // Analyze backup when file opens
    useEffect(() => {
        if (open && file) {
            resetState();
            // If it's a known database type, try to analyze
            if (file.sourceType) {
                analyzeBackup(file);
            }
        }
    }, [open, file, resetState, analyzeBackup]);

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
            // Check if we use advanced mapping
            let mapping = undefined;
            if (analyzedDbs.length > 0) {
                 mapping = dbConfig
                     .filter(c => c.selected)
                     .map(c => ({ originalName: c.name, targetName: c.targetName, selected: true }));
            }

            // Add root auth info if privileged
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
            }

            const res = await fetch(`/api/storage/${destinationId}/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok && data.success) {
                toast.success("Restore started in background");
                onSuccess();
                onOpenChange(false);
                // Redirect to history to show progress
                router.push(`/dashboard/history?executionId=${data.executionId}&autoOpen=true`);
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
                    // Fallback
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

    if (!file) return null;

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!restoring) onOpenChange(val);
        }}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Restore Backup</DialogTitle>
                    <DialogDescription>
                        Review the details below before starting the recovery process.
                    </DialogDescription>
                </DialogHeader>

                {/* File Details Card */}
                <div className="flex items-start gap-4 p-4 mb-2 border rounded-lg bg-secondary/20">
                    <div className="p-2 rounded bg-background border shadow-sm">
                        <FileIcon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 space-y-1">
                        <p className="font-medium leading-none">{file.name}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <HardDrive className="h-3 w-3" /> {formatBytes(file.size)}
                            </span>
                            <span>
                                {new Date(file.lastModified).toLocaleString()}
                            </span>
                            {file.sourceType && (
                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tracking-normal">
                                    {file.sourceType} {file.engineVersion}
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>

                {!restoreLogs ? (
                    <div className="space-y-6 py-2">
                        {/* Target Selection */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">1. Select Destination Target</Label>
                            <Select value={targetSource} onValueChange={setTargetSource}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select Database Source..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {sources
                                        // Filter sources: If we know the backup type, only show matching adapters.
                                        .filter(s => {
                                            if (!file?.sourceType) return true;
                                            // Handle mapping: "mysql" (backup) -> "mysql" or "mariadb" (adapter)
                                            // Some adapters share compatibility.
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
                            <p className="text-[0.8rem] text-muted-foreground">
                                All data in the target database(s) will be overwritten.
                            </p>
                        </div>

                        {/* Database Mapping */}
                        {isAnalyzing ? (
                            <div className="space-y-3">
                                <Label className="text-sm font-medium">2. Analyzing Backup Content...</Label>
                                <div className="space-y-2">
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                            </div>
                        ) : analyzedDbs.length > 0 ? (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm font-medium">2. Database Mapping</Label>
                                    <Badge variant="outline" className="text-xs font-normal">
                                        {dbConfig.filter(d => d.selected).length} Selected
                                    </Badge>
                                </div>
                                <div className="border rounded-md overflow-hidden bg-card">
                                    <Table>
                                        <TableHeader className="bg-muted/50">
                                            <TableRow className="hover:bg-transparent border-b text-xs uppercase tracking-wider">
                                                <TableHead className="w-[30px]"></TableHead>
                                                <TableHead>Source DB</TableHead>
                                                <TableHead className="w-[30px]"></TableHead>
                                                <TableHead>Target DB Name</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {dbConfig.map(db => (
                                                <TableRow key={db.id} className={!db.selected ? 'opacity-50 bg-muted/20' : ''}>
                                                    <TableCell className="py-2">
                                                        <Checkbox
                                                            id={`chk-${db.id}`}
                                                            checked={db.selected}
                                                            onCheckedChange={() => handleToggleDb(db.id)}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="py-2 font-medium">
                                                        <Label htmlFor={`chk-${db.id}`} className="cursor-pointer">{db.name}</Label>
                                                    </TableCell>
                                                    <TableCell className="py-2">
                                                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                                    </TableCell>
                                                    <TableCell className="py-2">
                                                        <Input
                                                            value={db.targetName}
                                                            onChange={(e) => handleRenameDb(db.id, e.target.value)}
                                                            className="h-8 text-sm"
                                                            placeholder="Target Name"
                                                            disabled={!db.selected}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        ) : targetSource && !isAnalyzing ? (
                             <div className="space-y-4">
                                <Label>2. Restore Configuration</Label>
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
                                                    // Auto-select radio if typing
                                                    const radio = document.getElementById('r2') as HTMLInputElement;
                                                    if(radio) radio.checked = true;
                                                }}
                                                className="h-8"
                                            />
                                        </div>
                                    </div>
                                </RadioGroup>
                            </div>
                        ) : null}

                         {/* Warning */}
                         <Alert variant="destructive" className="py-2">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle className="text-sm font-semibold ml-2">Warning</AlertTitle>
                            <AlertDescription className="text-xs ml-2">
                                This action is irreversible. Ensure you have a backup of the target if needed.
                            </AlertDescription>
                        </Alert>
                    </div>
                ) : (
                    <div className="space-y-4 py-4">
                        <div className="bg-destructive/10 p-4 rounded-md border border-destructive/20 space-y-2">
                             <div className="flex items-center gap-2 text-destructive font-medium">
                                 <AlertTriangle className="h-4 w-4" />
                                 Restore Failed
                             </div>
                             <div className="text-xs font-mono bg-background/50 p-2 rounded border overflow-x-auto max-h-[150px]">
                                {restoreLogs?.map((l: string, i: number) => (
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
                                <div className="grid grid-cols-2 gap-2">
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
                    </div>
                )}


                <DialogFooter className="gap-2 sm:gap-0">
                     {!restoreLogs && (
                         <>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                            <Button onClick={() => handleRestore(false)} disabled={restoring || !targetSource || (analyzedDbs.length > 0 && !dbConfig.some(d => d.selected))}>
                                {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {restoring ? 'Starting...' : 'Start Restore'}
                            </Button>
                         </>
                     )}
                     {restoreLogs && !showPrivileged && (
                         <Button onClick={() => onOpenChange(false)}>Close</Button>
                     )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Info({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
    )
}
