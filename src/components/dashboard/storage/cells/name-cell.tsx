import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface NameCellProps {
    name: string;
    path: string;
    isEncrypted?: boolean;
}

export function NameCell({ name, path, isEncrypted }: NameCellProps) {
    return (
        <div className="flex flex-col space-y-1">
            <div className="flex items-center gap-2">
                {isEncrypted && (
                     <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                <Lock className="h-3.5 w-3.5 text-amber-500/80" />
                            </TooltipTrigger>
                            <TooltipContent>Encrypted Backup</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
                <span className="font-medium text-sm">{name}</span>
            </div>
            <span className="text-[10px] text-muted-foreground truncate max-w-[250px] font-mono" title={path}>
                {path}
            </span>
        </div>
    );
}
