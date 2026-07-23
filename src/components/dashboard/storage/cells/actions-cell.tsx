import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, RotateCcw, Trash2, Lock, FileLock2, FileCheck, Terminal, ShieldCheck, ShieldX, Shield, PackageOpen, Database, FolderInput, Layers } from "lucide-react";
import { FileInfo } from "@/app/dashboard/storage/columns";
import { needsRestoreScopeChoice, type RestoreMode } from "@/components/dashboard/storage/restore-scope";

const ARCHIVED_STORAGE_CLASSES = ["GLACIER", "DEEP_ARCHIVE"];

interface ActionsCellProps {
    file: FileInfo;
    onDownload: (file: FileInfo, decrypt?: boolean) => void;
    onRestore: (file: FileInfo, mode?: RestoreMode) => void;
    /** Materialises a complete snapshot out of its incremental chain. */
    onDownloadSnapshot?: (file: FileInfo) => void;
    onDelete: (file: FileInfo) => void;
    onToggleLock?: (file: FileInfo) => void;
    onGenerateLink?: (file: FileInfo) => void;
    onVerify?: (file: FileInfo) => void;
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
}

export function ActionsCell({
    file,
    onDownload,
    onRestore,
    onDownloadSnapshot,
    onDelete,
    onToggleLock,
    onGenerateLink,
    onVerify,
    canDownload,
    canRestore,
    canDelete
}: ActionsCellProps) {
    const isArchived = ARCHIVED_STORAGE_CLASSES.includes(file.storageClass ?? "");
    // Only a backup that actually contains both kinds needs the restore scope picker.
    const hasBothKinds = needsRestoreScopeChoice(file.combined);
    const archivedTooltip = "This backup is archived in S3 Glacier or Deep Archive. Restore it via the AWS Console first (S3 - select object - Actions - Initiate restore).";

    const verifyIcon = file.verification
        ? file.verification.passed
            ? <ShieldCheck className="h-4 w-4" />
            : <ShieldX className="h-4 w-4" />
        : <Shield className="h-4 w-4" />;

    const verifyClass = file.verification
        ? file.verification.passed
            ? "text-green-600 hover:text-green-700"
            : "text-red-600 hover:text-red-700"
        : "text-muted-foreground hover:text-foreground";

    const verifyTooltip = file.verification
        ? file.verification.passed
            ? "Integrity verified - click to re-verify"
            : "Integrity check failed - click to re-verify"
        : "Verify integrity";

    return (
        <div className="flex items-center justify-end gap-2">
            {onVerify && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={`h-8 w-8 ${verifyClass}`}
                                onClick={() => onVerify(file)}
                            >
                                {verifyIcon}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{verifyTooltip}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
            {onToggleLock && canDelete && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={`h-8 w-8 ${file.locked ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
                                onClick={() => onToggleLock(file)}
                            >
                                {file.locked ? <FileLock2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{file.locked ? "Unlock Backup (Allow deletion)" : "Lock Backup (Protect from retention)"}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {canDownload && (
                isArchived ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-40 cursor-not-allowed" disabled>
                                        <Download className="h-4 w-4" />
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{archivedTooltip}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : file.isEncrypted ? (
                    <DropdownMenu>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Download Options</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onDownload(file, false)}>
                                <FileLock2 className="mr-2 h-4 w-4" />
                                <span>Download Encrypted (.enc)</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onDownload(file, true)}>
                                <FileCheck className="mr-2 h-4 w-4" />
                                <span>Download Decrypted</span>
                            </DropdownMenuItem>
                            {onDownloadSnapshot && file.chain && (
                                <DropdownMenuItem onClick={() => onDownloadSnapshot(file)}>
                                    <PackageOpen className="mr-2 h-4 w-4" />
                                    <span>Download Complete Snapshot</span>
                                </DropdownMenuItem>
                            )}
                            {onGenerateLink && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onGenerateLink(file)}>
                                        <Terminal className="mr-2 h-4 w-4" />
                                        <span>wget / curl Link</span>
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <DropdownMenu>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Download Options</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onDownload(file, false)}>
                                <Download className="mr-2 h-4 w-4" />
                                <span>Download</span>
                            </DropdownMenuItem>
                            {onDownloadSnapshot && file.chain && (
                                <DropdownMenuItem onClick={() => onDownloadSnapshot(file)}>
                                    <PackageOpen className="mr-2 h-4 w-4" />
                                    <span>Download Complete Snapshot</span>
                                </DropdownMenuItem>
                            )}
                            {onGenerateLink && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onGenerateLink(file)}>
                                        <Terminal className="mr-2 h-4 w-4" />
                                        <span>wget / curl Link</span>
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            )}

            {canRestore && (
                isArchived ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-40 cursor-not-allowed" disabled>
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{archivedTooltip}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : hasBothKinds ? (
                    // The backup holds databases *and* directory sources, so ask what to
                    // restore up front instead of opening a page with both halves and
                    // making the user deselect one.
                    <DropdownMenu>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                            <RotateCcw className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Restore Options</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onRestore(file, "all")}>
                                <Layers className="mr-2 h-4 w-4" />
                                <span>Restore Everything</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onRestore(file, "databases")}>
                                <Database className="mr-2 h-4 w-4" />
                                <span>Databases Only</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onRestore(file, "files")}>
                                <FolderInput className="mr-2 h-4 w-4" />
                                <span>Files Only</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRestore(file)}>
                                    <RotateCcw className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Restore</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )
            )}

            {canDelete && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(file)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    );
}
