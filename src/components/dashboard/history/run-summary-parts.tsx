"use client";

import { useState } from "react";
import { ChevronRight, Database, Info, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { parseCommand } from "@/lib/logs/line-source";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { RunDump, RunKind, RunOutput, RunStepState, RunSummaryItem } from "@/services/history/run-types";
import { LiveBar } from "./run-cells";
import { CommandLine } from "./run-command";
import { Mono, SourceBadge } from "./run-log-lines";
import { RunningIcon } from "./run-live";
import { StepIcon } from "./run-steps-pane";

/**
 * The pieces of the summary of a run: what runs now, and the rows of a step. One click opens a row
 * to everything it holds, its whole command and the lines written about it, in place and without a
 * frame of their own. What runs now is open without a click.
 */

interface NowRowProps {
    lead: React.ReactNode;
    name: string;
    part?: string | null;
    percent: number | null;
    text: string;
    eta?: string | null;
    hint?: string | null;
    /** Inside a list of rows, without a frame of its own. */
    flat?: boolean;
}

/** What runs right now, filling one row in place instead of a new line every few seconds. */
export function NowRow({ lead, name, part, percent, text, eta, hint, flat = false }: NowRowProps) {
    return (
        <div className={cn("px-3 py-2.5 text-sm", flat ? "" : "my-1 rounded-lg border border-info/30 bg-info/5")}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="w-7 shrink-0 text-xs font-semibold text-info">now</span>
                <RunningIcon className="size-3.5" />
                <span className="flex min-w-0 items-center gap-2 font-medium">
                    {lead}
                    <span className="truncate">{name}</span>
                    {part && <span className="truncate font-normal text-muted-foreground">{part}</span>}
                </span>
                <LiveBar percent={percent} className="min-w-24 flex-1" />
                <span className="tabular-nums">{text}</span>
                {eta && <span className="text-muted-foreground">{eta}</span>}
            </div>
            {hint && (
                <p className="mt-1.5 flex items-center gap-1.5 pl-10 text-xs text-muted-foreground">
                    <Info className="size-3 shrink-0" aria-hidden="true" />{hint}
                </p>
            )}
        </div>
    );
}

export function dumpNow(dump: RunDump): Omit<NowRowProps, "lead" | "flat"> {
    const progress = dump.progress;
    const percent = progress?.share !== null && progress?.share !== undefined ? Math.round(progress.share * 100) : null;
    const share = percent === null ? "" : `${progress?.exact ? "" : "about "}${percent} % · `;
    return {
        name: dump.name,
        part: progress?.part ?? null,
        percent,
        text: `${share}${progress?.text ?? "starting"}`,
        eta: progress?.etaMs ? `about ${formatDuration(progress.etaMs)} left` : null,
        hint: progress && !progress.exact && progress.share !== null ? `The tool tells no progress, so this compares what is written with the ${formatBytes(dump.lastBytes ?? 0)} of ${dump.name} last time.` : null,
    };
}

/** The newest lines of an output, the older ones on Show all. */
const NEWEST = 8;

function lineCount(count: number): string {
    return count === 1 ? "1 line" : `${count} lines`;
}

/**
 * The lines a tool, destination or source wrote, right under the row they belong to. A head names
 * who wrote them when that is not the row itself, like mongodump under a database.
 */
export function LinesBlock({ output, label, live = false }: { output: RunOutput; label: string; live?: boolean }) {
    const [all, setAll] = useState(false);
    const { formatDate } = useDateFormatter();
    const long = output.lines.length > NEWEST;
    const lines = all || !long ? output.lines : output.lines.slice(-NEWEST);
    const newest = output.lines.at(-1)?.at;
    return (
        <div className="min-w-0">
            {(output.source !== label || long) && (
                <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <SourceBadge source={output.source} />
                    <span className="truncate">{lineCount(output.lines.length)}{live && newest ? `, the newest at ${formatDate(newest, "HH:mm:ss")}` : ""}</span>
                    {live && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-info" aria-hidden="true" />}
                    {long && (
                        <button type="button" onClick={() => setAll((value) => !value)} className="ml-auto shrink-0 rounded font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                            {all ? "Show the newest" : `Show all ${output.lines.length}`}
                        </button>
                    )}
                </div>
            )}
            <ScrollArea className="border-l-2 *:data-[slot=scroll-area-viewport]:max-h-96">
                <div className="pl-3 font-mono text-xs leading-5">
                    {lines.map((line, index) => (
                        <div key={index} className="flex min-w-0 gap-3.5">
                            <span className="shrink-0 text-muted-foreground tabular-nums">{line.at ? formatDate(line.at, "HH:mm:ss") : ""}</span>
                            <span className={cn("min-w-0 break-words", line.level === "error" && "text-destructive", line.level === "warning" && "text-warning")}>{line.message}</span>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

/** The warnings about one database, each kind once with its count and its first line, nothing more to open. */
export function WarningList({ kinds }: { kinds: RunKind[] }) {
    const total = kinds.reduce((sum, kind) => sum + kind.count, 0);
    return (
        <div className="min-w-0 space-y-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
                <TriangleAlert className="size-3.5 text-warning" aria-hidden="true" />
                {total === 1 ? "1 warning" : `${total} warnings`}
                {kinds.length > 1 && <span className="font-normal text-muted-foreground">{kinds.length} kinds</span>}
            </p>
            {kinds.map((kind, index) => (
                <div key={index} className="min-w-0 pl-5.5">
                    <p className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex h-4.5 shrink-0 items-center rounded-full bg-warning/12 px-1.5 text-[11px] font-semibold text-warning tabular-nums">×{kind.count}</span>
                        <span className="truncate">{kind.title}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={kind.raw}>{kind.raw}</p>
                </div>
            ))}
        </div>
    );
}

/** Warnings that say the same thing about other tables, each kind once with how often it came up. */
export function WarningKinds({ kinds }: { kinds: RunKind[] }) {
    const [open, setOpen] = useState<number | null>(kinds.length === 1 ? 0 : null);
    const total = kinds.reduce((sum, kind) => sum + kind.count, 0);
    return (
        <div className="overflow-hidden rounded-lg border border-warning/35 bg-warning/5 text-sm">
            <p className="flex items-center gap-2 px-3 py-2 font-medium">
                <TriangleAlert className="size-3.5 text-warning" aria-hidden="true" />
                {total === 1 ? "1 warning" : `${total} warnings`}
                {kinds.length > 1 && <span className="font-normal text-muted-foreground">{kinds.length} kinds</span>}
            </p>
            {kinds.map((kind, index) => (
                <div key={index} className="border-t border-warning/20">
                    <button
                        type="button"
                        aria-expanded={open === index}
                        onClick={() => setOpen(open === index ? null : index)}
                        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left outline-none hover:bg-warning/5 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open === index && "rotate-90")} aria-hidden="true" />
                        <span className="inline-flex h-4.5 shrink-0 items-center rounded-full bg-warning/12 px-1.5 text-[11px] font-semibold text-warning tabular-nums">×{kind.count}</span>
                        <span className="min-w-0 truncate">{kind.title}</span>
                    </button>
                    {open === index && (
                        <div className="space-y-1.5 px-3 pb-3 pl-12">
                            <p><Mono tone="warning">{kind.raw}</Mono></p>
                            {kind.count > 1 && <p className="text-xs text-muted-foreground">and {kind.count - 1} more {kind.count === 2 ? "line" : "lines"} like it</p>}
                            {kind.help && <p className="text-sm">{kind.help}</p>}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

const DUMP_STATE: Record<RunDump["state"], RunStepState> = { waiting: "pending", dumping: "running", done: "done", failed: "failed" };

function dumpFacts(dump: RunDump): { facts: string | null; right: string } {
    if (dump.state === "waiting") return { facts: dump.lastBytes ? `${formatBytes(dump.lastBytes)} last time` : null, right: "next" };
    if (dump.state === "failed") return { facts: dump.errors.at(-1) ?? null, right: "failed" };
    const size = dump.bytes !== null ? formatBytes(dump.bytes) : null;
    const took = dump.durationMs !== null ? formatDuration(dump.durationMs) : null;
    return { facts: dump.facts, right: [size, took].filter(Boolean).join(" · ") };
}

/** The line of a row that opens, with how many lines it holds so a reader knows before the click. */
function RowButton({ open, openable, onToggle, children }: { open: boolean; openable: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            disabled={!openable}
            aria-expanded={openable ? open : undefined}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left text-sm outline-none enabled:hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
            <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !openable && "invisible", open && "rotate-90")} aria-hidden="true" />
            {children}
        </button>
    );
}

function Count({ count }: { count: number }) {
    return count > 0 ? <span className="text-muted-foreground/70"> · {lineCount(count)}</span> : null;
}

/** What opens under a row, starting under its state so it takes little room. */
function Panel({ children }: { children: React.ReactNode }) {
    return <div className="min-w-0 space-y-3 pr-4 pb-3.5 pl-9">{children}</div>;
}

/** One database of the dump step. The one dumping now fills in place and shows its command and newest lines. */
export function DumpRow({ dump, live }: { dump: RunDump; live: boolean }) {
    const running = dump.state === "dumping";
    const [open, setOpen] = useState(dump.state === "failed" || dump.warnings.length > 0);
    const lines = dump.outputs.reduce((sum, output) => sum + output.lines.length, 0);
    const openable = Boolean(dump.command) || lines > 0 || dump.warnings.length > 0 || dump.errors.length > 0;
    const shown = (running || open) && openable;
    const { facts, right } = dumpFacts(dump);
    const state = dump.state === "done" && dump.warnings.length > 0 ? "warning" : DUMP_STATE[dump.state];
    const tool = dump.command ? parseCommand(dump.command)?.binary.split("/").at(-1) ?? null : null;
    return (
        <div className={cn(running ? "bg-info/5" : shown && "bg-muted/40")}>
            {running ? (
                <NowRow lead={<Database className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />} flat {...dumpNow(dump)} />
            ) : (
                <RowButton open={open} openable={openable} onToggle={() => setOpen((value) => !value)}>
                    <StepIcon state={state} className="size-3.5" />
                    <Database className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className={cn("shrink-0 font-medium", dump.state === "waiting" && "text-muted-foreground")}>{dump.name}</span>
                    {facts && <span className={cn("min-w-0 truncate", dump.state === "failed" ? "text-destructive" : "text-muted-foreground")}>{facts}</span>}
                    <span className="ml-auto shrink-0 pl-2 text-muted-foreground tabular-nums">{right}<Count count={lines} /></span>
                </RowButton>
            )}
            {shown && (
                <Panel>
                    {dump.command && <CommandLine command={dump.command} />}
                    {dump.errors.length > 0 && <div className="space-y-1">{dump.errors.map((error, index) => <p key={index}><Mono tone="error">{error}</Mono></p>)}</div>}
                    {dump.warnings.length > 0 && <WarningList kinds={dump.warnings} />}
                    {dump.outputs.map((output) => <LinesBlock key={output.source} output={output} label={dump.name} live={running && live} />)}
                    {dump.outputs.length === 0 && dump.command && !running && <p className="text-xs text-muted-foreground">{tool ?? "The tool"} wrote no other lines.</p>}
                </Panel>
            )}
        </div>
    );
}

const ITEM_STATE: Record<RunSummaryItem["state"], RunStepState> = { done: "done", failed: "failed", running: "running", waiting: "pending", skipped: "pending", warning: "warning" };

/** A destination, folder or channel of a step, opening to the lines it wrote. What uploads now is open. */
export function ItemRow({ item, now }: { item: RunSummaryItem; now?: React.ReactNode }) {
    const [open, setOpen] = useState(item.state === "failed");
    const lines = item.outputs.reduce((sum, output) => sum + output.lines.length, 0);
    const openable = lines > 0;
    const running = Boolean(now);
    const shown = (running || open) && openable;
    return (
        <div className={cn(running ? "bg-info/5" : shown && "bg-muted/40")}>
            {now ?? (
                <RowButton open={open} openable={openable} onToggle={() => setOpen((value) => !value)}>
                    <StepIcon state={ITEM_STATE[item.state]} className="size-3.5" />
                    {item.adapterId && <AdapterIcon adapterId={item.adapterId} className="size-3.5 shrink-0" />}
                    <span className={cn("shrink-0 font-medium", (item.state === "waiting" || item.state === "skipped") && "text-muted-foreground")}>{item.label}</span>
                    <span className="ml-auto min-w-0 truncate pl-2 text-right text-muted-foreground" title={item.text}>
                        <span className={cn(item.state === "failed" && "text-destructive")}>{item.text}</span><Count count={lines} />
                    </span>
                </RowButton>
            )}
            {shown && (
                <Panel>
                    {item.outputs.map((output) => <LinesBlock key={output.source} output={output} label={item.label} live={running} />)}
                </Panel>
            )}
        </div>
    );
}

/** Rows of a step in one frame, a line between each. */
export function Rows({ children }: { children: React.ReactNode }) {
    return <div className="mt-2.5 divide-y overflow-hidden rounded-xl border">{children}</div>;
}

/** A sentence of the summary, with the program the step ran as a badge where it says {tool}. */
export function Told({ text, tool }: { text: string; tool: string | null }) {
    const [before, after] = text.split("{tool}");
    return (
        <p className="mt-1 text-sm leading-6">
            {before}
            {after !== undefined && tool && <SourceBadge source={tool} />}
            {after}
        </p>
    );
}
