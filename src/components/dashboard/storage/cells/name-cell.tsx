import { FileInfo } from "@/app/dashboard/storage/columns";

interface NameCellProps {
    name: string;
    path: string;
}

export function NameCell({ name, path }: NameCellProps) {
    return (
        <div className="flex flex-col space-y-1">
            <span className="font-medium text-sm">{name}</span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[250px] font-mono" title={path}>
                {path}
            </span>
        </div>
    );
}
