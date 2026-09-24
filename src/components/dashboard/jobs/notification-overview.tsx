"use client";

import { Check, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { OUTCOME_CHIPS, OUTCOME_DOTS, OUTCOME_LABELS, OUTCOMES, repeatsOf, summaryOf, type Listener, type Outcome } from "@/components/templates/notification-model";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { cn } from "@/lib/utils";

/** "Every run" for a channel told after every run, a chip for each run otherwise. */
export function OutcomeChips({ outcomes }: { outcomes: Outcome[] }) {
    if (outcomes.length === OUTCOMES.length) {
        return <span className="inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium text-muted-foreground">Every run</span>;
    }
    return (
        <span className="inline-flex flex-wrap gap-1">
            {outcomes.map((outcome) => (
                <span key={outcome} className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", OUTCOME_CHIPS[outcome])}>
                    {OUTCOME_LABELS[outcome]}
                </span>
            ))}
        </span>
    );
}

/** "Slack Webhook · from Ops alerts", or "Named directly" for a channel without a template. */
function sourceOf(listener: Listener): string {
    const type = getAdapterDefinition(listener.adapterId)?.name;
    const { via } = listener;
    const from = via.length === 0 ? "Named directly" : via.length === 1 ? `from ${via[0]}` : via.length === 2 ? `from ${via[0]} and ${via[1]}` : `from ${via.length} templates`;
    return [type, from].filter(Boolean).join(" · ");
}

function Cell({ listener, outcome }: { listener: Listener; outcome: Outcome }) {
    const count = listener.messages[outcome];
    if (count === 0) {
        return (
            <>
                <span className="inline-block size-1.5 rounded-full bg-border" aria-hidden="true" />
                <span className="sr-only">No message</span>
            </>
        );
    }
    if (count > 1) {
        return (
            <span className="inline-flex h-6 items-center rounded-full bg-warning/15 px-2 text-xs font-semibold text-warning">
                <span aria-hidden="true">{count}×</span>
                <span className="sr-only">{count} messages</span>
            </span>
        );
    }
    return (
        <span className={cn("inline-flex size-6 items-center justify-center rounded-full", OUTCOME_CHIPS[outcome])}>
            <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
            <span className="sr-only">1 message</span>
        </span>
    );
}

/**
 * Who hears about a run of the job, over all its templates: every channel with a column for each
 * run, the same channel through two templates counted twice, like the runner sends it. On a phone
 * each channel lists its runs as chips instead.
 */
export function NotificationOverview({ listeners }: { listeners: Listener[] }) {
    const summary = summaryOf(listeners);
    const repeats = repeatsOf(listeners);

    return (
        <div className="space-y-2.5">
            <p className="text-sm font-medium">Who hears about a run</p>
            <div className="overflow-hidden rounded-lg border">
                <Table className="hidden sm:table">
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-3">Channel</TableHead>
                            {OUTCOMES.map((outcome) => (
                                <TableHead key={outcome} className="w-24 text-center">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className={cn("size-1.5 rounded-full", OUTCOME_DOTS[outcome])} aria-hidden="true" />
                                        {OUTCOME_LABELS[outcome]}
                                    </span>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {listeners.map((listener) => (
                            <TableRow key={listener.configId} className="hover:bg-transparent">
                                <TableCell className="max-w-0 pl-3">
                                    <span className="flex min-w-0 items-center gap-2.5">
                                        <AdapterIcon adapterId={listener.adapterId} className="size-4 shrink-0" />
                                        <span className="grid min-w-0">
                                            <span className="truncate font-medium">{listener.name}</span>
                                            <span className="truncate text-xs text-muted-foreground">{sourceOf(listener)}</span>
                                        </span>
                                    </span>
                                </TableCell>
                                {OUTCOMES.map((outcome) => (
                                    <TableCell key={outcome} className="text-center">
                                        <Cell listener={listener} outcome={outcome} />
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <ul className="divide-y sm:hidden">
                    {listeners.map((listener) => (
                        <li key={listener.configId} className="flex items-start gap-2.5 px-3 py-2.5">
                            <AdapterIcon adapterId={listener.adapterId} className="mt-0.5 size-4 shrink-0" />
                            <span className="grid min-w-0 gap-1">
                                <span className="truncate text-sm font-medium">{listener.name}</span>
                                <OutcomeChips outcomes={OUTCOMES.filter((outcome) => listener.messages[outcome] > 0)} />
                            </span>
                        </li>
                    ))}
                </ul>
                <p className={cn("border-t bg-page/60 px-3 py-2 text-xs", summary.silentFailure ? "text-warning" : "text-muted-foreground")}>{summary.text}</p>
            </div>
            {repeats.length > 0 && (
                <div role="status" className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span className="grid gap-1">
                        {repeats.map((repeat) => (
                            <span key={repeat.configId}>{repeat.text}</span>
                        ))}
                    </span>
                </div>
            )}
        </div>
    );
}
