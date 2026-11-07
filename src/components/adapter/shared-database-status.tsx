"use client";

import { Building2 } from "lucide-react";
import { namesFor } from "@/lib/core/tab-attention";
import type { SharedServerTerms } from "@/services/sharing/shared-server-rows";
import type { SharedOnDemand } from "@/services/tenant/shared-on-demand";

/**
 * Where a server of another tenant and its databases stand: its provider runs it, or a backup the
 * tenant started runs now or waits for its turn, the one state that takes the blue of a running status.
 */

/** The status of the row: who runs the server, or the backups of its databases that run now. Never a health check of the server. */
export function SharedStatusCell({ terms }: { terms: Pick<SharedServerTerms, "databases" | "providerName"> }) {
    const active = terms.databases.filter(({ database }) => database.onDemand?.active);
    if (active.length > 0) {
        const running = active.filter(({ database }) => database.onDemand?.active?.state === "running");
        const names = (running.length > 0 ? running : active).map(({ database }) => database.databaseName);
        return (
            <span className="inline-flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 animate-pulse rounded-full bg-info" aria-hidden="true" />
                <span className="truncate text-sm">{running.length > 0 ? `Backing up ${namesFor(names)}` : `${namesFor(names)} ${names.length === 1 ? "waits" : "wait"} for its turn`}</span>
            </span>
        );
    }
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={`${terms.providerName} runs it`}>{terms.providerName} runs it</span>
        </span>
    );
}

/** The dot of the quick filter of the databases whose backup runs now. */
export const RUNNING_DOT = "bg-info";

/** The badge of a database whose backup runs now or waits, in place of its Back up now. */
export function RunBadge({ active }: { active: NonNullable<SharedOnDemand["active"]> }) {
    return (
        <span role="status" className="shrink-0 rounded-md border border-info/40 bg-info/10 px-1.5 py-0.5 text-xs font-medium text-info">
            {active.state === "running" ? "Running" : "Queued"}
        </span>
    );
}
