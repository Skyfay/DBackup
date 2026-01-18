import { Badge } from "@/components/ui/badge";
import { Database, HardDrive } from "lucide-react";

interface SourceJobCellProps {
    jobName?: string;
    sourceName?: string;
    sourceType?: string;
    dbLabel?: string;
}

export function SourceJobCell({ jobName, sourceName, sourceType, dbLabel }: SourceJobCellProps) {
    if (!jobName && !sourceName) return <span className="text-muted-foreground">-</span>;

    return (
        <div className="flex flex-col space-y-1">
            {sourceName !== "Unknown" && sourceName && (
                <div className="flex items-center gap-1.5 text-sm">
                    <Database className="h-3 w-3 text-muted-foreground" />
                    <span>{sourceName}</span>
                    {sourceType && <Badge variant="outline" className="text-[9px] h-4 px-1">{sourceType}</Badge>}
                </div>
            )}
            {jobName !== "Unknown" && jobName && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HardDrive className="h-3 w-3" />
                    <span>{jobName}</span>
                    {dbLabel && dbLabel !== "Unknown" && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">{dbLabel}</Badge>
                    )}
                </div>
            )}
        </div>
    );
}
