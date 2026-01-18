import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { FileInfo } from "@/app/dashboard/storage/columns";

interface ActionsCellProps {
    file: FileInfo;
    onDownload: (file: FileInfo) => void;
    onRestore: (file: FileInfo) => void;
    onDelete: (file: FileInfo) => void;
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
}

export function ActionsCell({
    file,
    onDownload,
    onRestore,
    onDelete,
    canDownload,
    canRestore,
    canDelete
}: ActionsCellProps) {
    return (
        <div className="flex items-center justify-end gap-2">
            {canDownload && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDownload(file)}>
                                <Download className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Download</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {canRestore && (
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
