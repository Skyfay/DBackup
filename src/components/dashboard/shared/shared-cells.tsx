"use client";

import { Building2 } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { SharedRow } from "./shared-model";

/** The last check of a backup in the shape of the badge of an own backup. */
export const checkOf = (row: Pick<SharedRow, "verification">) =>
    // The badge reads whether it passed, the trigger only matters for the panel of an own backup.
    row.verification ? { verifiedAt: row.verification.at, passed: row.verification.passed, trigger: "scheduled" as const } : undefined;

/** A small tag beside a database that is no longer the tenant's, or whose server was deleted. */
export function FormerTag({ label = "Former" }: { label?: string }) {
    return <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">{label}</span>;
}

/** Who runs the server and its backups, as a quiet chip like a copy of an own backup. Never a destination of theirs. */
export function ProviderChip({ name }: { name: string }) {
    return (
        <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium whitespace-nowrap">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{name}</span>
        </span>
    );
}

/** The size of the dump of the one database, never of the archive around it. */
export function DumpSizeCell({ row }: { row: Pick<SharedRow, "dump"> }) {
    if (!row.dump) return <div className="text-right text-sm text-muted-foreground" title="Not read from the backup yet">-</div>;
    return (
        <div className="text-right tabular-nums">
            <div className="text-sm font-medium">{formatBytes(row.dump.stored)}</div>
            {row.dump.unpacked > row.dump.stored && <div className="text-xs text-muted-foreground">{formatBytes(row.dump.unpacked)} unpacked</div>}
        </div>
    );
}
