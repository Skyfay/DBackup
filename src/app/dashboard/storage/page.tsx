"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Download, RotateCcw, Search, Database } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";

interface AdapterConfig {
    id: string;
    originalId: string;
    name: string;
    type: string;
    adapterId: string;
}

interface FileInfo {
    name: string;
    path: string;
    size: number;
    lastModified: string;
}

export default function StoragePage() {
    const [destinations, setDestinations] = useState<AdapterConfig[]>([]);
    const [sources, setSources] = useState<AdapterConfig[]>([]);
    const [selectedDestination, setSelectedDestination] = useState<string>("");

    const [files, setFiles] = useState<FileInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState("");

    // Restore Modal State
    const [restoreFile, setRestoreFile] = useState<FileInfo | null>(null);
    const [targetSource, setTargetSource] = useState<string>("");
    const [targetDbName, setTargetDbName] = useState<string>("");
    const [restoring, setRestoring] = useState(false);
    const [restoreLogs, setRestoreLogs] = useState<string[] | null>(null);

    // Privileged restore state
    const [showPrivileged, setShowPrivileged] = useState(false);
    const [privUser, setPrivUser] = useState("root");
    const [privPass, setPrivPass] = useState("");

    useEffect(() => {
        fetchAdapters();
    }, []);

    useEffect(() => {
        if (selectedDestination) {
            fetchFiles(selectedDestination);
        } else {
            setFiles([]);
        }
    }, [selectedDestination]);

    const fetchAdapters = async () => {
        try {
            const res = await fetch("/api/adapters");
            if (res.ok) {
                const all = await res.json();
                setDestinations(all.filter((a: AdapterConfig) => a.type === "storage"));
                setSources(all.filter((a: AdapterConfig) => a.type === "database"));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchFiles = async (destId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/storage/${destId}/files`);
            if (res.ok) {
                setFiles(await res.json());
            } else {
                toast.error("Failed to fetch files");
            }
        } catch (e) {
            toast.error("Error fetching files");
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = (file: FileInfo) => {
        // Trigger download via API
        // Using window.location or hidden link
        const url = `/api/storage/${selectedDestination}/download?file=${encodeURIComponent(file.path)}`;
        window.open(url, '_blank');
    };

    const handleRestoreClick = (file: FileInfo) => {
        setRestoreFile(file);
        setTargetSource("");
        setTargetDbName("");
        setRestoreLogs(null);
        setShowPrivileged(false);
        setPrivPass("");
    };

    const confirmRestore = async (usePrivileged = false) => {
        if (!restoreFile || !targetSource) return;

        setRestoring(true);
        // Don't clear logs immediately if retrying, but here we probably want to to show fresh attempt
        setRestoreLogs(null);
        
        try {
            const payload: any = {
                 file: restoreFile.path,
                targetSourceId: targetSource,
                targetDatabaseName: targetDbName || undefined
            };

            if (usePrivileged) {
                payload.privilegedAuth = {
                    user: privUser,
                    password: privPass
                };
            }

            const res = await fetch(`/api/storage/${selectedDestination}/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok && data.success) {
                toast.success("Restore completed successfully");
                setRestoreFile(null); // Close modal
            } else {
                toast.error("Restore failed");
                const logs = data.logs || [];
                if (logs.length > 0) {
                     setRestoreLogs(logs);
                     // Check for common permission errors to show retry UI
                     const logString = logs.join('\n');
                     if (logString.includes("Access denied") || logString.includes("User permissions?")) {
                         setShowPrivileged(true);
                     }
                } else {
                    setRestoreLogs(["Error: " + (data.error || "Unknown error")]);
                }
            }
        } catch (e) {
            toast.error("Restore request failed");
        } finally {
            setRestoring(false);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    // Filtering logic
    const filteredFiles = files.filter(f =>
        f.name.toLowerCase().includes(filter.toLowerCase()) ||
        f.path.toLowerCase().includes(filter.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">Storage Explorer</h2>

            <div className="flex items-center space-x-4">
                <div className="w-[300px]">
                    <Select value={selectedDestination} onValueChange={setSelectedDestination}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select Destination" />
                        </SelectTrigger>
                        <SelectContent>
                            {destinations.map(d => (
                                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {selectedDestination && (
                    <div className="flex-1 relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Filter files..."
                            className="pl-8"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                        />
                    </div>
                )}
            </div>

            {selectedDestination && (
                 <Card>
                    <CardHeader>
                        <CardTitle>Backups ({filteredFiles.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>File Name</TableHead>
                                    <TableHead>Size</TableHead>
                                    <TableHead>Last Modified</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center">Loading...</TableCell>
                                    </TableRow>
                                ) : filteredFiles.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No files found.</TableCell>
                                    </TableRow>
                                ) : filteredFiles.map((file) => (
                                    <TableRow key={file.path}>
                                        <TableCell className="font-medium">
                                            <div className="flex flex-col">
                                                <span>{file.name}</span>
                                                <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[300px]">{file.path}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>{formatSize(file.size)}</TableCell>
                                        <TableCell>{new Date(file.lastModified).toLocaleString()}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="outline" size="sm" onClick={() => handleDownload(file)}>
                                                    <Download className="h-4 w-4 mr-1" />
                                                    Download
                                                </Button>
                                                <Button variant="secondary" size="sm" onClick={() => handleRestoreClick(file)}>
                                                    <RotateCcw className="h-4 w-4 mr-1" />
                                                    Restore
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                 </Card>
            )}

            {/* Restore Modal */}
            <Dialog open={!!restoreFile} onOpenChange={(o) => { if(!o) setRestoreFile(null); }}>
                <DialogContent className="sm:max-w-[800px]">
                    <DialogHeader>
                        <DialogTitle>Restore Backup</DialogTitle>
                        <DialogDescription>
                            Restore <b>{restoreFile?.name}</b> to a database source.
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
                                        {/* TODO: Ideally filter by compatible adapter types based on file naming convention or metadata */}
                                        {sources.map(s => (
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
                        </div>
                    ) : (
                         <div className="space-y-4 py-4">
                            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm whitespace-pre-wrap break-all max-h-[400px] overflow-auto font-mono">
                                {restoreLogs.join('\n')}
                            </div>
                         </div>
                    )}

                    <DialogFooter>
                        {!restoreLogs ? (
                            <>
                                <Button variant="outline" onClick={() => setRestoreFile(null)} disabled={restoring}>Cancel</Button>
                                <Button onClick={() => confirmRestore(false)} disabled={!targetSource || restoring}>
                                    {restoring ? "Restoring..." : "Start Restore"}
                                </Button>
                            </>
                        ) : (
                            <div className="flex flex-col w-full gap-4">
                                {showPrivileged && (
                                    <div className="bg-muted p-4 rounded-md border text-sm space-y-3">
                                        <p className="font-semibold text-warning-foreground">Permission Denied?</p>
                                        <p className="text-muted-foreground">Try restoring using a privileged user (e.g., 'root') to create the database.</p>
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
                                            onClick={() => confirmRestore(true)}
                                            disabled={restoring}
                                        >
                                            {restoring ? "Retrying as Root..." : "Retry with Privileges"}
                                        </Button>
                                    </div>
                                )}
                                <div className="flex justify-end gap-2">
                                     <Button variant="outline" onClick={() => setRestoreFile(null)}>Close</Button>
                                     <Button variant="secondary" onClick={() => { setRestoreLogs(null); setShowPrivileged(false); }}>Back to Settings</Button>
                                </div>
                            </div>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
