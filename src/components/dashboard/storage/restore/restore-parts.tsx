"use client";

import { AlertTriangle, Check, CircleHelp, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type OutcomeTone = "warning" | "success" | "muted";

const TAG = {
    warning: "border-warning/30 bg-warning/10 text-warning",
    success: "border-success/30 bg-success/10 text-success",
    muted: "border-transparent bg-muted text-muted-foreground",
} as const;

/** What happens to a database or a folder, as a small tag at the end of its row. */
export function OutcomeTag({ tone, icon = "none", children, className }: { tone: OutcomeTone; icon?: "alert" | "plus" | "check" | "help" | "spin" | "none"; children: React.ReactNode; className?: string }) {
    const Icon = { alert: AlertTriangle, plus: Plus, check: Check, help: CircleHelp, spin: Loader2, none: null }[icon];
    return (
        <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium whitespace-nowrap", TAG[tone], className)}>
            {Icon && <Icon className={cn("size-3", icon === "spin" && "animate-spin")} aria-hidden="true" />}
            {children}
        </span>
    );
}

/** The arrow between a database and where it goes, amber when it overwrites, green and dashed when it is new. */
export function FlowArrow({ tone }: { tone: OutcomeTone | null }) {
    if (!tone) return <span aria-hidden="true" />;
    const color = tone === "warning" ? "stroke-warning" : tone === "success" ? "stroke-success" : "stroke-muted-foreground/60";
    return (
        <svg viewBox="0 0 56 14" className="h-3.5 w-12 shrink-0" aria-hidden="true">
            <path d="M 2 7 L 48 7" className={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={tone === "success" ? "4 4" : undefined} fill="none" />
            <path d="M 44 2 L 51 7 L 44 12" className={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
    );
}

/** A card of the page with its title, one line under it, and room for one control on the right. Without children it is the head alone, like a folded part. */
export function Section({ title, note, action, children, className }: { title: string; note?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode; className?: string }) {
    return (
        <section className={cn("min-w-0 rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
            <div className={cn("flex flex-wrap items-start gap-3 px-4 pt-4 md:px-5", !children && "pb-4 md:pb-5")}>
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{title}</h3>
                    {note && <p className="text-sm text-muted-foreground">{note}</p>}
                </div>
                {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
            </div>
            {children && <div className="p-4 md:p-5">{children}</div>}
        </section>
    );
}

/** A tinted line that says why something needs a look, amber for a warning and red for what blocks. */
export function Notice({ tone, icon: Icon = AlertTriangle, title, children }: { tone: "warning" | "destructive"; icon?: React.ComponentType<{ className?: string }>; title?: string; children: React.ReactNode }) {
    return (
        <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", tone === "warning" ? "border-warning/30 bg-warning/5" : "border-destructive/30 bg-destructive/5")}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-destructive")} aria-hidden="true" />
            <div className="min-w-0">
                {title && <p className="font-medium">{title}</p>}
                <div className={cn(title && "text-muted-foreground")}>{children}</div>
            </div>
        </div>
    );
}
