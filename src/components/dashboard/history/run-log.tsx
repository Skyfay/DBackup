"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ChevronDown, ChevronUp, Database, ListFilter, ScrollText, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stageLabel } from "@/lib/core/logs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateDisplay } from "@/components/utils/date-display";
import { formatDuration } from "@/lib/utils";
import type { RunDetail } from "@/services/history/run-types";
import { LogActions } from "./run-log-actions";
import { GroupHead, StepLines } from "./run-log-lines";
import { LiveUploadRow } from "./run-live";
import { dumpNow, NowRow } from "./run-summary-parts";
import type { SpeedSample } from "./use-run";

/** Which step the log shows, a field in the gray of the filters of a table. */
function StepSelect({ steps, picked, onPick }: { steps: string[]; picked: string | null; onPick: (step: string | null) => void }) {
    return (
        <span className="flex items-center gap-1">
            <Select value={picked ?? "all"} onValueChange={(value) => onPick(value === "all" ? null : value)}>
                <SelectTrigger size="sm" className="min-w-36 gap-2 text-xs" aria-label="The step the log shows">
                    <ListFilter className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Every step</SelectItem>
                    {steps.map((step) => <SelectItem key={step} value={step}>{stageLabel(step)}</SelectItem>)}
                </SelectContent>
            </Select>
            {picked && <Button variant="ghost" size="icon" className="size-8" onClick={() => onPick(null)} aria-label="Show every step"><X /></Button>}
        </span>
    );
}

interface RunLogProps {
    run: RunDetail;
    now: number;
    speed: SpeedSample[];
    picked: string | null;
    onPick: (step: string | null) => void;
    focused: string | null;
    onFocus: (problem: string | null) => void;
    tabs: React.ReactNode;
    className?: string;
}

/** Every line of a run under the step it belongs to, the lines of a problem marked together, live while it runs. */
export function RunLog({ run, now, speed, picked, onPick, focused, onFocus, tabs, className }: RunLogProps) {
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
    const dumping = run.summary.flatMap((entry) => entry.dumps).find((dump) => dump.state === "dumping");

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
    const purged = run.logsPurgedAt !== null;

    return (
        <section aria-label="Log" className={className}>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                {tabs}
                <div className="relative w-full sm:w-48">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the log" aria-label="Search the log" className="h-8 pl-8" />
                </div>
                <StepSelect steps={run.steps.map((entry) => entry.name)} picked={picked} onPick={onPick} />
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
                    <LogActions run={run} />
                </span>
            </div>
            <ScrollArea className="min-h-0 flex-1" viewportRef={viewport} onScrollCapture={onScroll}>
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
                        <p className="px-3 py-10 text-center text-sm text-muted-foreground">{term ? "No line matches the search." : lineCount === 0 ? "No lines yet." : "No line of this step matches."}</p>
                    ) : steps.map((entry) => (
                        <div key={entry.name}>
                            <GroupHead step={entry} now={now} />
                            <StepLines step={entry} problems={problems} focused={focused} />
                            {entry.name === "Dumping Databases" && entry.state === "running" && dumping && mode === "all" && !term && (
                                <NowRow lead={<Database className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />} {...dumpNow(dumping)} />
                            )}
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
