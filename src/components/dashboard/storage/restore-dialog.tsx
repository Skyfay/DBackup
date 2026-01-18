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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Database } from "lucide-react";
import { toast } from "sonner";
import { FileInfo } from "@/app/dashboard/storage/columns";
import { useRouter } from "next/navigation";

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
                        targetName: db,
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
            analyzeBackup(file);
        }
    }, [open, file, resetState, analyzeBackup]);

    const handleRestore = async (usePrivileged = false) => {
        if (!file || !targetSource) return;

        setRestoring(true);
        setRestoreLogs(null);

        try {
            // Check if we use advanced mapping
            let mapping = undefined;
            if (analyzedDbs.length > 0) {
                 mapping = dbConfig.map(c => ({ originalName: c.name, targetName: c.targetName, selected: c.selected }));
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
                if (logs.length > 0) {
                     setRestoreLogs(logs);
                     const logString = logs.join('\n');
                     if (logString.includes("Access denied") || logString.includes("User permissions?")) {
                         setShowPrivileged(true);
                     }
                } else {
                    setRestoreLogs(["Error: " + (data.error || "Unknown error")]);
                }
            }
        } catch {
            toast.error("Restore request failed");
        } finally {
            setRestoring(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!restoring) onOpenChange(val);
        }}>
            <DialogContent className="sm:max-w-200">
                <DialogHeader>
                    <DialogTitle>Restore Backup</DialogTitle>
                    <DialogDescription>
                        Restore <b>{file?.name}</b> to a database source.
                    </DialogDescription>
                </DialogHeader>

                {!restoreLogs ? (
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Target Source</Label>
                            <Select value={targetSource} onValueChange={setTargetSource}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a database source" />
                                </SelectTrigger>
                                <SelectContent>
                                    {sources
                                        // Filter sources to match backup type (e.g., only restore mysql backup to mysql source)
                                        // We check 'adapterId' (e.g. 'mysql', 'postgres') against file.sourceType
                                        .filter(s => !file?.sourceType || s.adapterId === file.sourceType)
                                        .map(s => (
                                        <SelectItem key={s.id} value={s.id}>
                                            <div className="flex items-center gap-2">
                                                <Database className="h-4 w-4" />
                                                <span>{s.name}</span>
                                                <Badge variant="outline" className="text-[10px] h-4">{s.adapterId}</Badge>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {isAnalyzing ? (
                            <div className="space-y-2 border rounded-md p-3">
                                <Label>Analyzing Backup...</Label>
                                <div className="space-y-2">
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                </div>
                            </div>
                        ) : analyzedDbs.length > 0 ? (
                            <div className="space-y-2 border rounded-md p-3">
                                <Label>Databases detected in Dump</Label>
                                <div className="space-y-2 max-h-50 overflow-y-auto">
                                    {dbConfig.map((db, idx) => (
                                        <div key={db.id} className="flex items-center gap-2 p-2 bg-secondary/50 rounded-sm">
                                            <Checkbox
                                                checked={db.selected}
                                                onCheckedChange={(checked) => {
                                                    const newC = [...dbConfig];
                                                    newC[idx].selected = checked === true;
                                                    setDbConfig(newC);
                                                }}
                                            />
                                            <div className="flex-1 grid grid-cols-2 gap-2 items-center">
                                                <span className="text-sm font-medium truncate" title={db.name}>{db.name}</span>
                                                <Input
                                                    className="h-7 text-xs"
                                                    placeholder="Target Name"
                                                    value={db.targetName}
                                                    onChange={e => {
                                                         const newC = [...dbConfig];
                                                         newC[idx].targetName = e.target.value;
                                                         setDbConfig(newC);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[10px] text-muted-foreground">Uncheck to skip. Rename to restore to a different database.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label>Target Database Name (Optional)</Label>
                                <Input
                                    placeholder="Enter to rename / restore as new..."
                                    value={targetDbName}
                                    onChange={(e) => setTargetDbName(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Leave empty to overwrite the original database (<b>Warning: Data will be lost</b>).
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                     <div className="space-y-4 py-4">
                        <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm whitespace-pre-wrap break-all max-h-100 overflow-auto font-mono">
                            {restoreLogs.join('\n')}
                        </div>
                     </div>
                )}

                <DialogFooter>
                    {!restoreLogs ? (
                        <>
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restoring}>Cancel</Button>
                            <Button onClick={() => handleRestore(false)} disabled={!targetSource || restoring}>
                                {restoring ? "Restoring..." : "Start Restore"}
                            </Button>
                        </>
                    ) : (
                        <div className="flex flex-col w-full gap-4">
                            {showPrivileged && (
                                <div className="bg-muted p-4 rounded-md border text-sm space-y-3">
                                    <p className="font-semibold text-warning-foreground">Permission Denied?</p>
                                    <p className="text-muted-foreground">Try restoring using a privileged user (e.g., &apos;root&apos;) to create the database.</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <Label>Root User</Label>
                                            <Input value={privUser} onChange={e => setPrivUser(e.target.value)} placeholder="root" />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Root Password</Label>
                                            <Input type="password" value={privPass} onChange={e => setPrivPass(e.target.value)} placeholder="Secret" />
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        className="w-full"
                                        onClick={() => handleRestore(true)}
                                        disabled={restoring}
                                    >
                                        {restoring ? "Retrying as Root..." : "Retry with Privileges"}
                                    </Button>
                                </div>
                            )}
                            <div className="flex justify-end gap-2">
                                 <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                                 <Button variant="secondary" onClick={() => { setRestoreLogs(null); setShowPrivileged(false); }}>Back to Settings</Button>
                            </div>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
