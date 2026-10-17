"use client";

import { Ban, Zap } from "lucide-react";
import type { OnDemandLine } from "./assignment-model";

/** The line of backups on demand under a database or a rule, with where its number comes from. Nothing without one. */
export function OnDemandNote({ line }: { line: OnDemandLine | null }) {
    if (!line) return null;
    const Icon = line.off ? Ban : Zap;
    return (
        <p className="flex max-w-64 items-center gap-1 truncate text-xs text-muted-foreground">
            <Icon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
                {line.text}
                {line.from && <span className="text-muted-foreground/80"> · {line.from}</span>}
            </span>
        </p>
    );
}
