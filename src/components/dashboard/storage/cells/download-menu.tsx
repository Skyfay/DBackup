import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Database, Download, FileCheck, FileLock2, PackageOpen, Terminal } from "lucide-react";
import { FileInfo } from "@/app/dashboard/storage/columns";
import { getDownloadOptions } from "@/components/dashboard/storage/download-options";

interface DownloadMenuProps {
    file: FileInfo;
    onDownload: (file: FileInfo, decrypt?: boolean) => void;
    /** Unpacks the backup's contents, or a complete snapshot out of its chain, into a .tar.gz. */
    onDownloadSnapshot?: (file: FileInfo) => void;
    /** Opens the picker for one database out of several. */
    onDownloadDatabase?: (file: FileInfo) => void;
    onGenerateLink?: (file: FileInfo) => void;
}

/** The download button of a backup row and the options its format allows. */
export function DownloadMenu({ file, onDownload, onDownloadSnapshot, onDownloadDatabase, onGenerateLink }: DownloadMenuProps) {
    const options = getDownloadOptions(file);

    return (
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
                    {file.isEncrypted ? <FileLock2 className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}
                    <span>{options.raw.label}</span>
                </DropdownMenuItem>
                {options.decrypted && (
                    <DropdownMenuItem onClick={() => onDownload(file, true)}>
                        <FileCheck className="mr-2 h-4 w-4" />
                        <span>{options.decrypted.label}</span>
                    </DropdownMenuItem>
                )}
                {options.pickDatabase && onDownloadDatabase && (
                    <DropdownMenuItem onClick={() => onDownloadDatabase(file)}>
                        <Database className="mr-2 h-4 w-4" />
                        <span>{options.pickDatabase.label}</span>
                    </DropdownMenuItem>
                )}
                {options.contents && onDownloadSnapshot && (
                    <DropdownMenuItem onClick={() => onDownloadSnapshot(file)}>
                        <PackageOpen className="mr-2 h-4 w-4" />
                        <span>{options.contents.label}</span>
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
    );
}
