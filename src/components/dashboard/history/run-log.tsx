"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ChevronDown, ChevronUp, Copy, Download, ScrollText, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateDisplay } from "@/components/utils/date-display";
import type { LogEntry } from "@/lib/core/logs";
import { formatLogsAsText, generateLogFilename } from "@/lib/logs/format";
import { sanitizeLogs } from "@/lib/logs/sanitize";
import { cn, formatDuration } from "@/lib/utils";
import type { RunDetail } from "@/services/history/run-types";
import { GroupHead, StepLines } from "./run-log-lines";
import { LiveUploadRow } from "./run-live";
import type { SpeedSample } from "./use-run";

const TRIGGER: Record<string, string> = { schedule: "Scheduler", manual: "Manual", api: "Api" };

function logText(run: RunDetail): string {
    const entries: LogEntry[] = run.steps.flatMap((step) => step.lines.map((line) => ({
        timestamp: line.at, level: line.level, type: line.type, message: line.message, stage: step.name, details: line.details,
    })));
    return formatLogsAsText(sanitizeLogs(entries), {
        jobName: run.job?.name ?? run.name,
        type: run.type,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        triggerType: TRIGGER[run.starter.kind] ?? null,
        triggerLabel: run.starter.label,
    });
}

interface RunLogProps {
    run: RunDetail;
    now: number;
    speed: SpeedSample[];
    picked: string | null;
    onPick: (step: string | null) => void;
    focused: string | null;
    onFocus: (problem: string | null) => void;
    className?: string;
}

/** Every line of a run under the step it belongs to, the lines of a problem marked together, live while it runs. */
export function RunLog({ run, now, speed, picked, onPick, focused, onFocus, className }: RunLogProps) {
    const [search, setSearch] = useState("");
    const [mode, setMode] = useState<"all" | "problems">("all");
    const live = run.status === "Running" || run.status === "Pending";
    const [following, setFollowing] = useState(true);
    const [unseen, setUnseen] = useState(0);
    const viewport = useRef<HTMLDivElement>(null);
    const counted = useRef(0);
    const toBottom = () => {
        const element = viewport.current;
        if (element) element.scrollTop = element.scrollHeight;
    };

    const problems = useMemo(() => new Map(run.problems.map((problem) => [problem.id, problem])), [run.problems]);
    const term = search.trim().toLowerCase();
    const steps = run.steps
        .filter((step) => !picked || step.name === picked)
        .map((step) => ({ ...step, lines: step.lines.filter((line) => (mode === "all" || line.problem) && (!term || line.message.toLowerCase().includes(term))) }))
        .filter((step) => step.lines.length > 0 || step.state === "running");
    // The problems in the order the log shows them, for the arrows.
    const order = [...new Set(run.steps.flatMap((step) => step.lines.flatMap((line) => (line.problem ? [line.problem] : []))))];
    const position = focused ? order.indexOf(focused) : -1;
    const lineCount = run.steps.reduce((sum, step) => sum + step.lines.length, 0);
    const pending = live ? run.steps.filter((step) => step.state === "pending") : [];
    const pendingMs = pending.reduce((sum, step) => sum + (step.usualMs ?? 0), 0);

    // A live log follows its newest line, until the reader scrolls up. Then it counts what came in.
    useEffect(() => {
        const added = lineCount - counted.current;
        counted.current = lineCount;
        if (!live || added <= 0) return;
        if (following) toBottom();
        else setUnseen((value) => value + added);
    }, [lineCount, live, following]);

    useEffect(() => {
        if (!focused) return;
        const frame = requestAnimationFrame(() => document.getElementById(`problem-${focused}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
        return () => cancelAnimationFrame(frame);
    }, [focused, picked, mode]);

    const onScroll = () => {
        const element = viewport.current;
        if (!element || !live) return;
        const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        if (atBottom && !following) {
            setFollowing(true);
            setUnseen(0);
        } else if (!atBottom && following) setFollowing(false);
    };
    const follow = () => {
        setFollowing(true);
        setUnseen(0);
        toBottom();
    };
    const step = (delta: number) => {
        if (order.length === 0) return;
        const next = order[(position + delta + order.length) % order.length];
        onFocus(next);
    };
    const copy = () => navigator.clipboard.writeText(logText(run)).then(() => toast.success("The log is copied")).catch(() => toast.error("The log could not be copied"));
    const download = () => {
        const url = URL.createObjectURL(new Blob([logText(run)], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = generateLogFilename(run.job?.name ?? run.name, run.startedAt);
        link.click();
        URL.revokeObjectURL(url);
    };
    const purged = run.logsPurgedAt !== null;

    return (
        <section aria-label="Log" className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
            <div className="space-y-3 px-5 pt-4 pb-3">
                <div className="flex items-baseline gap-2">
                    <h2 className="font-semibold">Log</h2>
                    <p className="truncate text-sm text-muted-foreground">
                        {picked ? `the lines of ${picked}` : live ? "live, the newest line at the bottom" : `${lineCount.toLocaleString()} lines`}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {picked && (
                        <Button variant="outline" size="sm" tone="filter" className="border-tone/50 bg-tone/5 dark:bg-tone/10" onClick={() => onPick(null)} aria-label={`Show every step, not only ${picked}`}>
                            {picked}<X />
                        </Button>
                    )}
                    <div className="relative w-full sm:w-52">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the log" aria-label="Search the log" className="h-8 pl-8" />
                    </div>
                    {order.length > 0 && (
                        <>
                            <Tabs value={mode} onValueChange={(value) => setMode(value as "all" | "problems")}>
                                <TabsList className="h-8">
                                    <TabsTrigger value="all" className="px-2.5 text-xs">All lines</TabsTrigger>
                                    <TabsTrigger value="problems" className="px-2.5 text-xs">Problems <span className="ml-1 font-normal text-muted-foreground">{order.length}</span></TabsTrigger>
                                </TabsList>
                            </Tabs>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                                <Button variant="outline" size="icon" className="size-8" onClick={() => step(-1)} aria-label="The problem before"><ChevronUp /></Button>
                                {position >= 0 ? `${position + 1} of ${order.length}` : `${order.length}`}
                                <Button variant="outline" size="icon" className="size-8" onClick={() => step(1)} aria-label="The next problem"><ChevronDown /></Button>
                            </span>
                        </>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                        {live && (
                            <Button variant="outline" size="sm" onClick={following ? () => setFollowing(false) : follow} aria-pressed={following}>
                                <ArrowDownToLine />{following ? "Following" : "Follow"}
                            </Button>
                        )}
                        <Button variant="outline" size="icon" className="size-8" onClick={copy} disabled={purged} aria-label="Copy the log"><Copy /></Button>
                        <Button variant="outline" size="icon" className="size-8" onClick={download} disabled={purged} aria-label="Download the log"><Download /></Button>
                    </span>
                </div>
            </div>
            <ScrollArea className="min-h-0 flex-1 border-t" viewportRef={viewport} onScrollCapture={onScroll}>
                <div className="px-2 py-2">
                    {purged ? (
                        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                            <ScrollText className="size-8 text-muted-foreground" aria-hidden="true" />
                            <p className="text-sm font-medium">The log of this run was removed</p>
                            <p className="max-w-md text-sm text-muted-foreground">
                                Data retention cleared it on <DateDisplay date={run.logsPurgedAt!} format="PP" />. Its status, size and times are still kept.
                            </p>
                        </div>
                    ) : steps.length === 0 ? (
                        <p className="px-3 py-10 text-center text-sm text-muted-foreground">{term ? "No line matches the search." : "No lines yet."}</p>
                    ) : steps.map((entry) => (
                        <div key={entry.name}>
                            <GroupHead step={entry} now={now} />
                            <StepLines step={entry} problems={problems} focused={focused} />
                            {entry.name === "Uploading" && entry.state === "running" && run.uploads.filter((upload) => upload.state === "uploading").map((upload) => (
                                <LiveUploadRow key={upload.configId} upload={upload} speed={speed} />
                            ))}
                        </div>
                    ))}
                    {pending.length > 0 && !picked && mode === "all" && (
                        <p className="mx-1 mt-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                            Then {pending.map((entry) => entry.name).join(", ")}{pendingMs > 0 ? `, usually ${formatDuration(pendingMs)} together` : ""}
                        </p>
                    )}
                </div>
            </ScrollArea>
            {unseen > 0 && (
                <Button size="sm" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-lg" onClick={follow}>
                    <ArrowDown />{unseen === 1 ? "1 new line" : `${unseen} new lines`}
                </Button>
            )}
        </section>
    );
}
