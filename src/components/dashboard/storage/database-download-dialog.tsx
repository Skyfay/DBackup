"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Download, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/utils";
import type { KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import { keyOverrideBody, type KeyOverrideBody } from "@/hooks/use-encryption-key-recovery";
import { startPreparedArchiveDownload } from "./prepared-download";

interface DatabaseDetail {
    name: string;
    format: string;
    size: number;
}

interface DatabaseDownloadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    destinationId: string;
    file: { name: string; path: string; sourceType?: string } | null;
    /** The key the page already settled on for this backup, if a prompt happened earlier. */
    keyOverride?: KeyOverrideBody;
    /** The page's key-recovery hook. Returns true when it opened the key dialog. */
    interceptKeyRequest: (
        response: Response,
        retry: (result: KeyResolutionResult) => void | Promise<void>
    ) => Promise<boolean>;
    /** Opens the wget / curl link dialog for one database. */
    onGenerateLink?: (database: string) => void;
}

/**
 * Lists the databases in a backup and downloads any one of them on its own.
 *
 * Each dump is read out of the archive by byte range, so fetching one database from a backup
 * of a whole server moves that database and nothing else.
 */
export function DatabaseDownloadDialog({
    open,
    onOpenChange,
    destinationId,
    file,
    keyOverride,
    interceptKeyRequest,
    onGenerateLink,
}: DatabaseDownloadDialogProps) {
    const [databases, setDatabases] = useState<DatabaseDetail[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    // Held in a ref so a parent passing a fresh function on every render does not re-run the
    // analysis on every render.
    const interceptRef = useRef(interceptKeyRequest);
    useEffect(() => {
        interceptRef.current = interceptKeyRequest;
    }, [interceptKeyRequest]);

    const load = useCallback(async (resolved?: KeyResolutionResult) => {
        if (!file) return;
        setDatabases(null);
        setError(null);
        try {
            const res = await fetch(`/api/storage/${destinationId}/analyze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: file.path, type: file.sourceType, ...(resolved ? keyOverrideBody(resolved) : keyOverride) }),
            });
            if (await interceptRef.current(res, (result) => load(result))) return;

            const data: { databaseDetails?: DatabaseDetail[]; error?: string } = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error ?? "This backup could not be read.");
                return;
            }
            setDatabases(data.databaseDetails ?? []);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "This backup could not be read.");
        }
    }, [destinationId, file, keyOverride]);

    useEffect(() => {
        if (open && file) void load();
    }, [open, file, load]);

    const download = async (database: string, resolved?: KeyResolutionResult) => {
        if (!file) return;
        setDownloading(database);
        try {
            await startPreparedArchiveDownload({
                destinationId,
                body: { file: file.path, databases: [database], ...(resolved ? keyOverrideBody(resolved) : keyOverride) },
                intercept: (res) => interceptRef.current(res, (result) => download(database, result)),
                preparingLabel: `Preparing ${database}...`,
            });
        } finally {
            setDownloading(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] p-0">
                <div className="px-6 pt-6 pb-4 shrink-0">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Database className="h-5 w-5" />
                            Download Database
                        </DialogTitle>
                        <DialogDescription className="break-all">
                            {file ? `Download a single database dump out of ${file.name}.` : "Download a single database dump."}
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90vh-10rem)]">
                    <div className="px-6 pb-4">
                        {error ? (
                            <p className="text-sm text-destructive">{error}</p>
                        ) : databases === null ? (
                            <div className="space-y-2">
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-3/4" />
                            </div>
                        ) : databases.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                This backup holds no individual database dumps. Download its contents instead.
                            </p>
                        ) : (
                            <div className="border rounded-md overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow className="hover:bg-transparent text-xs uppercase tracking-wider">
                                            <TableHead>Database</TableHead>
                                            <TableHead className="w-24">Format</TableHead>
                                            <TableHead className="w-24 text-right">Size</TableHead>
                                            <TableHead className="w-24" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {databases.map((db) => (
                                            <TableRow key={db.name}>
                                                <TableCell className="py-2 font-medium break-all">{db.name}</TableCell>
                                                <TableCell className="py-2">
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{db.format}</Badge>
                                                </TableCell>
                                                <TableCell className="py-2 text-right text-muted-foreground">{formatBytes(db.size)}</TableCell>
                                                <TableCell className="py-2">
                                                    <div className="flex justify-end gap-1">
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8"
                                                                        disabled={downloading !== null}
                                                                        onClick={() => void download(db.name)}
                                                                    >
                                                                        {downloading === db.name
                                                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                                                            : <Download className="h-4 w-4" />}
                                                                        <span className="sr-only">Download {db.name}</span>
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Download</TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                        {onGenerateLink && (
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-8 w-8"
                                                                            onClick={() => onGenerateLink(db.name)}
                                                                        >
                                                                            <Terminal className="h-4 w-4" />
                                                                            <span className="sr-only">wget / curl link for {db.name}</span>
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>wget / curl Link</TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                <div className="px-6 pt-2 pb-6">
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
