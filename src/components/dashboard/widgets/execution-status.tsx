import { cn } from "@/lib/utils";

interface StatusStyle {
    label: string;
    /** Text color for labels and badges. */
    text: string;
    /** Solid fill for dots, run bars and chart marks. */
    fill: string;
    /** Faint background for badges and highlighted rows. */
    tint: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
    Success: { label: "Done", text: "text-success", fill: "bg-success", tint: "bg-success/12" },
    Failed: { label: "Failed", text: "text-destructive", fill: "bg-destructive", tint: "bg-destructive/12" },
    Partial: { label: "Partial", text: "text-warning", fill: "bg-warning", tint: "bg-warning/12" },
    Running: { label: "Running", text: "text-info", fill: "bg-info", tint: "bg-info/12" },
    Pending: { label: "Queued", text: "text-muted-foreground", fill: "bg-muted-foreground/60", tint: "bg-muted" },
    Cancelled: { label: "Cancelled", text: "text-muted-foreground", fill: "bg-muted-foreground/40", tint: "bg-muted" },
};

const UNKNOWN_STATUS: StatusStyle = {
    label: "Unknown",
    text: "text-muted-foreground",
    fill: "bg-muted-foreground/40",
    tint: "bg-muted",
};

export function getStatusStyle(status: string | null | undefined): StatusStyle {
    if (!status) return UNKNOWN_STATUS;
    return STATUS_STYLES[status] ?? { ...UNKNOWN_STATUS, label: status };
}

interface ExecutionStatusBadgeProps {
    status: string | null;
    /** Shown instead of the status label, for example "Never ran". */
    label?: string;
    /** A legend of the statuses, where nothing runs, so the dot of Running stays still. */
    still?: boolean;
    className?: string;
}

/** Execution status as a tinted pill with a dot. The dot pulses while the run is live. */
export function ExecutionStatusBadge({ status, label, still = false, className }: ExecutionStatusBadgeProps) {
    const style = getStatusStyle(status);
    const isLive = status === "Running" && !still;

    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                style.tint,
                style.text,
                className
            )}
        >
            <span className={cn("size-1.5 rounded-full", style.fill, isLive && "animate-pulse")} aria-hidden="true" />
            {label ?? style.label}
        </span>
    );
}
