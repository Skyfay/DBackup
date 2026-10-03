"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { RunDetail } from "@/services/history/run-types";
import { RunChecksCard } from "./run-checks";
import { RunLog } from "./run-log";
import { RunSummary } from "./run-summary";
import type { SpeedSample } from "./use-run";

const CARD = "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm";

interface RunCenterProps {
    run: RunDetail;
    now: number;
    speed: SpeedSample[];
    picked: string | null;
    onPick: (step: string | null) => void;
    focused: string | null;
    onFocus: (problem: string | null) => void;
    className?: string;
}

/**
 * The middle of the page of a run: what it did in plain words, or for an integrity check and a
 * verification every copy they checked, and the whole log as the second tab.
 */
export function RunCenter({ run, now, speed, picked, onPick, focused, onFocus, className }: RunCenterProps) {
    const [tab, setTab] = useState<"first" | "log">("first");
    const lines = run.steps.reduce((sum, step) => sum + step.lines.length, 0);

    // A problem shown from the side opens the log at its lines.
    useEffect(() => {
        if (focused) setTab("log");
    }, [focused]);
    useEffect(() => setTab("first"), [run.id]);

    const tabs = (
        <Tabs value={tab} onValueChange={(value) => setTab(value as "first" | "log")}>
            <TabsList className="h-8">
                <TabsTrigger value="first" className="px-2.5 text-xs">
                    {run.checks ? <>Copies <span className="ml-1 font-normal text-muted-foreground">{run.checks.copies.length.toLocaleString()}</span></> : "Summary"}
                </TabsTrigger>
                <TabsTrigger value="log" className="px-2.5 text-xs">
                    Log <span className="ml-1 font-normal text-muted-foreground">{lines.toLocaleString()} {lines === 1 ? "line" : "lines"}</span>
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
    const classes = cn(CARD, className);

    if (tab === "log") {
        return <RunLog run={run} now={now} speed={speed} picked={picked} onPick={onPick} focused={focused} onFocus={onFocus} tabs={tabs} className={classes} />;
    }
    if (run.checks) return <RunChecksCard run={run} checks={run.checks} tabs={tabs} className={classes} />;
    return <RunSummary run={run} now={now} speed={speed} picked={picked} tabs={tabs} className={classes} />;
}
