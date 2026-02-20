"use client";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HealthHistoryGrid } from "@/components/adapter/health-history-grid";
import { useState } from "react";

import { DateDisplay } from "@/components/utils/date-display";

type HealthStatus = "ONLINE" | "DEGRADED" | "OFFLINE" | "PENDING";

interface HealthStatusBadgeProps {
    status: HealthStatus;
    adapterId: string;
    lastChecked?: Date | string | null;
    className?: string;
    interactive?: boolean;
}

export function HealthStatusBadge({ status, adapterId, lastChecked, className, interactive = true }: HealthStatusBadgeProps) {
    const [isOpen, setIsOpen] = useState(false);

    const statusColor = {
        ONLINE: "bg-green-500",
        DEGRADED: "bg-orange-500",
        OFFLINE: "bg-red-500 animate-pulse",
        PENDING: "bg-slate-300 dark:bg-slate-600",
    }[status] || "bg-gray-300";

    const statusLabel = {
        ONLINE: "Online",
        DEGRADED: "Degraded",
        OFFLINE: "Offline",
        PENDING: "Pending",
    }[status] || "Unknown";

    // Non-interactive mode: show badge only without popover
    if (!interactive) {
        return (
            <div
                className={cn(
                    "flex items-center gap-2 px-2 py-1 rounded-full w-fit",
                    className
                )}
            >
                <span className={cn("h-2.5 w-2.5 rounded-full", statusColor)} />
                <span className="text-sm font-medium hidden sm:inline-block text-muted-foreground">{statusLabel}</span>
            </div>
        );
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <div
                    className={cn(
                        "flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded-full transition-colors w-fit",
                        className
                    )}
                >
                    <span className={cn("h-2.5 w-2.5 rounded-full", statusColor)} />
                    <span className="text-sm font-medium hidden sm:inline-block text-muted-foreground">{statusLabel}</span>
                </div>
            </PopoverTrigger>
            <PopoverContent className="w-[340px] p-0" align="start">
                <div className="p-4 border-b">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={cn("h-3 w-3 rounded-full", statusColor)} />
                        <h4 className="font-semibold leading-none">{statusLabel}</h4>
                    </div>
                    {lastChecked && (
                        <p className="text-xs text-muted-foreground ml-5">
                            Last checked: <DateDisplay date={lastChecked} format="Pp" />
                        </p>
                    )}
                </div>
                <div className="p-4">
                    {isOpen && <HealthHistoryGrid adapterId={adapterId} />}
                </div>
            </PopoverContent>
        </Popover>
    );
}

// Temporary export until grid is ready to avoid build errors if used before grid exists
// In a real flow I'd create the Grid first or stub it, but here I'm creating the badge that depends on it.
// Actually, I should create the Grid next.
