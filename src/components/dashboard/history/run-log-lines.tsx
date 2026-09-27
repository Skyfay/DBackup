"use client";

import { Check, CircleX, HardDrive, Info, SquareTerminal, TriangleAlert } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { sourceOf } from "@/lib/logs/line-source";
import { cn, formatDuration } from "@/lib/utils";
import type { RunLine, RunProblem, RunStep } from "@/services/history/run-types";
import { CommandBlock } from "./run-command";
import { LivePill } from "./run-live";
import { ProblemBadges, StepIcon } from "./run-steps-pane";

/**
 * The pieces the log of a run is drawn from. Text is in the font of the app, only commands and raw
 * errors in mono. The tool, destination or source that wrote a line stands in front of it as a badge.
 */

/** The tool, destination or source a line comes from. */
export function SourceBadge({ source, className }: { source: string; className?: string }) {
    return (
        <span className={cn("inline-flex h-4.5 shrink-0 items-center rounded border bg-background px-1.5 align-[1px] font-mono text-[11px] leading-none text-muted-foreground", className)}>
            {source}
        </span>
    );
}

/**
 * The lines as the log shows them. The runner writes the start of a dump once in words and once as
 * the command it ran, and only the one with the command is shown.
 */
export function visibleLines(lines: RunLine[]): RunLine[] {
    return lines.filter((line, index) => {
        const next = lines[index + 1];
        return !(line.type !== "command" && next?.type === "command" && next.message === line.message);
    });
}

function LevelIcon({ line }: { line: RunLine }) {
    const className = "mt-0.5 size-3.5 shrink-0";
    if (line.level === "error") return <CircleX className={cn(className, "text-destructive")} aria-label="Error" />;
    if (line.level === "warning") return <TriangleAlert className={cn(className, "text-warning")} aria-label="Warning" />;
    if (line.level === "success") return <Check className={cn(className, "text-success")} aria-label="Done" />;
    if (line.type === "command") return <SquareTerminal className={cn(className, "text-muted-foreground")} aria-label="Command" />;
    if (line.type === "storage") return <HardDrive className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
    return <Info className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
}

export function Mono({ children, tone }: { children: React.ReactNode; tone?: "error" | "warning" }) {
    return (
        <code className={cn(
            "rounded px-1.5 py-0.5 font-mono text-xs break-words",
            tone === "error" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-warning/10 text-warning" : "bg-muted",
        )}>
            {children}
        </code>
    );
}

export function LogLine({ line, marked = false }: { line: RunLine; marked?: boolean }) {
    const { formatDate } = useDateFormatter();
    const tint = marked ? "" : line.level === "error" ? "bg-destructive/5 shadow-[inset_3px_0_0_var(--destructive)]" : line.level === "warning" ? "bg-warning/5 shadow-[inset_3px_0_0_var(--warning)]" : "";
    const { source, text } = sourceOf(line.message);
    const command = line.type === "command" && line.details ? line.details : null;
    return (
        <div className={cn("flex items-start gap-3 rounded-md px-3 py-1 text-sm", tint)}>
            {/* A log line keeps the seconds, the one place a fixed time format belongs. */}
            <span className="w-16 shrink-0 pt-px text-xs text-muted-foreground tabular-nums">{line.at ? formatDate(line.at, "HH:mm:ss") : ""}</span>
            <LevelIcon line={line} />
            <div className="min-w-0 flex-1">
                <p className="break-words">
                    {source && <><SourceBadge source={source} />{" "}</>}
                    {line.level === "error" ? <Mono tone="error">{text}</Mono> : text}
                </p>
                {command && <CommandBlock command={command} className="mt-1.5" />}
                {line.details && !command && (
                    <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted-foreground">Show details</summary>
                        <ScrollArea className="mt-1 rounded-md bg-muted *:data-[slot=scroll-area-viewport]:max-h-60">
                            <pre className="p-2 font-mono text-xs whitespace-pre-wrap">{line.details}</pre>
                        </ScrollArea>
                    </details>
                )}
            </div>
        </div>
    );
}

export function GroupHead({ step, now }: { step: RunStep; now: number }) {
    const duration = step.state === "running" && step.startedAt ? now - Date.parse(step.startedAt) : step.durationMs;
    return (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 text-sm font-semibold first:mt-0">
            <StepIcon state={step.state} className="size-3.5" />
            {step.name}
            {duration !== null && <span className="font-normal text-muted-foreground tabular-nums">{formatDuration(Math.max(0, duration))}{step.state === "running" ? " so far" : ""}</span>}
            {step.usualMs !== null && <span className="font-normal text-muted-foreground/70">· usual {formatDuration(step.usualMs)}</span>}
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <ProblemBadges errors={step.errors} warnings={step.warnings} />
            {step.state === "running" && <LivePill />}
        </div>
    );
}

/** The lines of one problem, marked as one, with its title on top. */
export function ProblemBlock({ problem, lines, focused, anchor }: { problem: RunProblem; lines: RunLine[]; focused: boolean; anchor: boolean }) {
    const error = problem.tone === "error";
    return (
        <div
            id={anchor ? `problem-${problem.id}` : undefined}
            className={cn(
                "my-1.5 scroll-mt-4 rounded-lg border py-1.5",
                error ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5",
                focused && (error ? "ring-2 ring-destructive/40" : "ring-2 ring-warning/40"),
            )}
        >
            <p className={cn("flex items-center gap-2 px-3 pb-1 text-sm font-semibold", error ? "text-destructive" : "text-warning")}>
                {error ? <CircleX className="size-3.5" aria-hidden="true" /> : <TriangleAlert className="size-3.5" aria-hidden="true" />}
                {problem.title}
                <span className="font-normal text-muted-foreground">{lines.length === 1 ? "the line of this problem" : `the ${lines.length} lines of this problem`}</span>
            </p>
            {lines.map((line, index) => <LogLine key={`${line.at}-${index}`} line={line} marked />)}
        </div>
    );
}

/** The lines of a step, with the lines of each problem gathered into its block. */
export function StepLines({ step, problems, focused }: { step: RunStep; problems: Map<string, RunProblem>; focused: string | null }) {
    const parts: React.ReactNode[] = [];
    const lines = visibleLines(step.lines);
    // Lines of one problem apart from each other get a block each, only the first one is the anchor to jump to.
    const anchored = new Set<string>();
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const problem = line.problem ? problems.get(line.problem) : undefined;
        if (!problem) {
            parts.push(<LogLine key={`l${index}`} line={line} />);
            index += 1;
            continue;
        }
        const own: RunLine[] = [];
        while (index < lines.length && lines[index].problem === problem.id) own.push(lines[index++]);
        parts.push(<ProblemBlock key={`p${index}`} problem={problem} lines={own} focused={focused === problem.id} anchor={!anchored.has(problem.id)} />);
        anchored.add(problem.id);
    }
    return <>{parts}</>;
}
