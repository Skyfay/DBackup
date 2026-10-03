"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { RunProblem } from "@/services/history/run-types";
import { RunCenter } from "./run-center";
import { DestinationsPane } from "./run-checks";
import { originOf } from "./run-links";
import { RunPageHead } from "./run-page-head";
import { RunRail, type RunAccess } from "./run-rail";
import { StepsPane } from "./run-steps-pane";
import { RunStrip } from "./run-strip";
import { useNow } from "./use-now";
import { useRun } from "./use-run";

function RunSkeleton() {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">Loading the run</span>
            <div className="flex items-center gap-4">
                <Skeleton className="h-8 w-28 rounded-md" />
                <Skeleton className="size-11 rounded-lg" />
                <div className="space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-3 w-72" />
                </div>
            </div>
            <Skeleton className="h-20 rounded-xl" />
            <div className="grid gap-4 md:gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
                <Skeleton className="h-96 rounded-xl" />
                <Skeleton className="h-96 rounded-xl" />
                <Skeleton className="h-96 rounded-xl" />
            </div>
        </div>
    );
}

/**
 * A run as a page of its own: its steps on the left with every copy and notification, in the middle
 * what it did in plain words and its log as a second tab, and on the right how long it still takes
 * while it is live, or what to look at after. An integrity check and a verification show every copy
 * they checked instead, with their destinations on the left. On a phone the right side comes first.
 */
export function RunPage({ access }: { access: RunAccess }) {
    const searchParams = useSearchParams();
    const id = searchParams.get("id");
    const { run, error, loading, speed, reload } = useRun(id);
    const [picked, setPicked] = useState<string | null>(null);
    const [focused, setFocused] = useState<string | null>(null);
    const now = useNow(run?.status === "Running" || run?.status === "Pending");

    useEffect(() => {
        setPicked(null);
        setFocused(null);
    }, [id]);

    if (loading) return <RunSkeleton />;
    if (!run) {
        const origin = originOf(searchParams.get("from"));
        return (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
                <ScrollText className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">This run could not be found</p>
                <p className="max-w-md text-sm text-muted-foreground">{error ?? "Data retention may have removed it."}</p>
                <Button variant="outline" asChild><Link href={origin.href}><ArrowLeft />Back to {origin.label}</Link></Button>
            </div>
        );
    }

    const showProblem = (problem: RunProblem) => {
        // A channel that did not take a message has no line of its own, its step shows it.
        if (problem.id.startsWith("n")) {
            setPicked(problem.step);
            setFocused(null);
            return;
        }
        setPicked(null);
        setFocused(problem.id);
    };

    return (
        <div className="flex flex-col gap-4 md:gap-6 xl:h-[calc(100svh-6.75rem)]">
            <RunPageHead run={run} access={access} onChanged={reload} />
            <RunStrip run={run} now={now} />
            <div className="grid min-h-0 flex-1 gap-4 md:gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
                <ScrollArea className="min-h-0 xl:order-3">
                    <RunRail run={run} now={now} speed={speed} access={access} onShowProblem={showProblem} />
                </ScrollArea>
                {run.checks
                    ? <DestinationsPane run={run} checks={run.checks} className="max-xl:max-h-[32rem] xl:order-1" />
                    : <StepsPane run={run} now={now} picked={picked} onPick={setPicked} className="max-xl:max-h-[32rem] xl:order-1" />}
                <RunCenter
                    run={run}
                    now={now}
                    speed={speed}
                    picked={picked}
                    onPick={setPicked}
                    focused={focused}
                    onFocus={setFocused}
                    className="max-xl:h-[75svh] xl:order-2"
                />
            </div>
        </div>
    );
}
