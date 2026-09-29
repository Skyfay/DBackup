"use client";

import { ArrowRight } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import type { ChangeRow } from "@/lib/core/audit-changes";
import { cn } from "@/lib/utils";
import type { AuditLine } from "@/services/audit/audit-types";
import { EntryIcon, Sentence } from "./audit-cells";

/** How a person signed in, as the end of "Signed in with ...". */
export const METHOD_WORDS: Record<string, string> = {
    password: "a password",
    passkey: "a passkey",
    "two-factor": "a password and a second factor",
    sso: "single sign-on",
};

function Level({ children }: { children: React.ReactNode }) {
    return <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium whitespace-nowrap">{children}</span>;
}

function Value({ children, before }: { children: React.ReactNode; before?: boolean }) {
    return (
        <span
            className={cn(
                "inline-flex min-h-6 max-w-full items-center rounded-md border bg-muted/40 px-2 text-xs break-words",
                before && "text-muted-foreground line-through decoration-muted-foreground/60"
            )}
        >
            {children}
        </span>
    );
}

function Chip({ sign, children }: { sign: "+" | "-"; children: React.ReactNode }) {
    return (
        <span
            className={cn(
                "inline-flex h-6 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
                sign === "+" ? "bg-success/10 text-success" : "bg-destructive/10 text-red-700 dark:text-destructive"
            )}
        >
            {sign} {children}
        </span>
    );
}

/** What changed, a row per field or area: the value before, an arrow, the value after, and the permissions it added or removed. */
export function ChangeRows({ rows }: { rows: ChangeRow[] }) {
    return (
        <div className="divide-y border-y">
            {rows.map((row, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <div className="min-w-0 space-y-2">
                        {row.secret ? (
                            <span className="text-sm text-muted-foreground">Changed, a secret keeps no values in the log</span>
                        ) : (row.from !== null || row.to !== null) && (
                            <div className="flex flex-wrap items-center gap-2">
                                {row.level ? <Level>{row.from ?? "None"}</Level> : <Value before>{row.from ?? "none"}</Value>}
                                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                {row.level ? <Level>{row.to ?? "None"}</Level> : <Value>{row.to ?? "none"}</Value>}
                            </div>
                        )}
                        {((row.added?.length ?? 0) > 0 || (row.removed?.length ?? 0) > 0) && (
                            <div className="flex flex-wrap gap-1.5">
                                {row.added?.map((name) => <Chip key={`+${name}`} sign="+">{name}</Chip>)}
                                {row.removed?.map((name) => <Chip key={`-${name}`} sign="-">{name}</Chip>)}
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Entries as short lines: the icon, who and the sentence, and when. */
export function EntryLines({ lines, withWho = true, time = "relative" }: { lines: AuditLine[]; withWho?: boolean; time?: "relative" | ((at: string) => string) }) {
    return (
        <ul className="space-y-0.5">
            {lines.map((line) => {
                // A failed sign-in names the account it tried, it has nobody to name in front.
                const by = withWho && line.kind !== "failed" ? line.by : null;
                return (
                <li key={line.id} className="flex min-w-0 items-center gap-2.5 py-1.5 text-sm">
                    <EntryIcon glyph={line.glyph} kind={line.kind} />
                    <span className="min-w-0 flex-1 truncate">
                        {by && <span className="text-muted-foreground">{by} </span>}
                        <Sentence parts={by ? lowerFirst(line.parts) : line.parts} />
                    </span>
                    {time === "relative" ? (
                        <RelativeTime date={line.at} className="shrink-0 text-xs text-muted-foreground" />
                    ) : (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time(line.at)}</span>
                    )}
                </li>
                );
            })}
        </ul>
    );
}

/** "Changed the job" after a name reads "Manu changed the job". */
function lowerFirst(parts: AuditLine["parts"]): AuditLine["parts"] {
    if (parts.length === 0 || parts[0].strong) return parts;
    const [first, ...rest] = parts;
    return [{ ...first, text: first.text.charAt(0).toLowerCase() + first.text.slice(1) }, ...rest];
}
