"use client";

import { useEffect } from "react";
import { ScrollText } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { RunDetail, RunStep, RunStepSummary, RunSummaryItem } from "@/services/history/run-types";
import { LogActions } from "./run-log-actions";
import { Mono } from "./run-log-lines";
import { bytesPerSecond, LivePill } from "./run-live";
import { ProblemBadges, StepIcon } from "./run-steps-pane";
import { DumpRow, ItemRow, NowRow, Rows, Told } from "./run-summary-parts";
import type { SpeedSample } from "./use-run";

export function summaryAnchor(step: string): string {
    return `summary-${step.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function stepTime(step: RunStep, now: number): string | null {
    const duration = step.state === "running" && step.startedAt ? Math.max(0, now - Date.parse(step.startedAt)) : step.durationMs;
    const took = duration !== null ? `${formatDuration(duration)}${step.state === "running" ? " so far" : ""}` : null;
    const usual = step.usualMs !== null ? `usual ${formatDuration(step.usualMs)}` : null;
    return [took, usual].filter(Boolean).join(" · ") || null;
}

/** A destination the backup uploads to right now, from the upload list and the speed measured on this page. */
function UploadNow({ run, item, speed }: { run: RunDetail; item: RunSummaryItem; speed: SpeedSample[] }) {
    const upload = run.uploads.find((entry) => (entry.configId || entry.name) === item.key);
    if (!upload) return null;
    const rate = bytesPerSecond(speed);
    const percent = upload.bytes !== null && upload.total ? Math.round((upload.bytes / upload.total) * 100) : null;
    const left = rate && upload.bytes !== null && upload.total ? Math.max(0, Math.round((upload.total - upload.bytes) / rate)) : null;
    const text = [percent !== null ? `${percent} %` : "starting", upload.bytes !== null && upload.total ? `${formatBytes(upload.bytes)} of ${formatBytes(upload.total)}` : null, rate ? `${formatBytes(rate)}/s` : null]
        .filter(Boolean).join(" · ");
    return (
        <NowRow
            flat
            lead={<AdapterIcon adapterId={upload.adapterId} className="size-3.5 shrink-0" />}
            name={upload.name}
            percent={percent}
            text={text}
            eta={left !== null ? `about ${formatDuration(left * 1000)} left` : null}
        />
    );
}

function Section({ run, step, summary, now, speed, last }: { run: RunDetail; step: RunStep; summary: RunStepSummary | undefined; now: number; speed: SpeedSample[]; last: boolean }) {
    const time = stepTime(step, now);
    const live = run.status === "Running" || run.status === "Pending";
    return (
        <li id={summaryAnchor(step.name)} className="relative flex scroll-mt-4 gap-3.5 pb-6 last:pb-2">
            {!last && <span className="absolute top-6 bottom-0 left-[7px] w-0.5 bg-border" aria-hidden="true" />}
            <span className="relative z-10 h-4 bg-card pt-0.5"><StepIcon state={step.state} /></span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h3 className="text-sm font-semibold">{step.name}</h3>
                    {time && <span className="text-xs text-muted-foreground tabular-nums">{time}</span>}
                    <ProblemBadges errors={step.errors} warnings={step.warnings} />
                    {step.state === "running" && <LivePill />}
                </div>
                {summary?.text && <Told text={summary.text} tool={summary.tool} />}
                {summary && summary.dumps.length > 0 && (
                    <Rows>{summary.dumps.map((dump) => <DumpRow key={dump.name} dump={dump} live={live} />)}</Rows>
                )}
                {summary && summary.items.length > 0 && (
                    <Rows>
                        {summary.items.map((item) => (
                            <ItemRow key={item.key} item={item} now={item.state === "running" && step.name === "Uploading" ? <UploadNow run={run} item={item} speed={speed} /> : undefined} />
                        ))}
                    </Rows>
                )}
                {summary?.now && <div className="mt-2.5"><NowRow lead={null} name={summary.now} percent={null} text="" /></div>}
                {summary?.checksum && (
                    <p className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        Every copy is checked against SHA-256 <Mono>{`${summary.checksum.slice(0, 8)}…${summary.checksum.slice(-8)}`}</Mono>
                    </p>
                )}
            </div>
        </li>
    );
}

interface RunSummaryProps {
    run: RunDetail;
    now: number;
    speed: SpeedSample[];
    picked: string | null;
    tabs: React.ReactNode;
    className?: string;
}

/** Every step of a run in a sentence or two, with a row for each database and destination, what runs now filling its row. */
export function RunSummary({ run, now, speed, picked, tabs, className }: RunSummaryProps) {
    const live = run.status === "Running" || run.status === "Pending";
    const shown = live ? run.steps.filter((step) => step.state !== "pending") : run.steps;
    const pending = live ? run.steps.filter((step) => step.state === "pending") : [];
    const pendingMs = pending.reduce((sum, step) => sum + (step.usualMs ?? 0), 0);

    // A step picked on the left comes into view here, the log shows its lines instead.
    useEffect(() => {
        if (!picked) return;
        const frame = requestAnimationFrame(() => document.getElementById(summaryAnchor(picked))?.scrollIntoView({ block: "start", behavior: "smooth" }));
        return () => cancelAnimationFrame(frame);
    }, [picked]);

    return (
        <section aria-label="Summary" className={className}>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                {tabs}
                <span className="ml-auto flex items-center gap-1.5"><LogActions run={run} /></span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                {run.logsPurgedAt ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                        <ScrollText className="size-8 text-muted-foreground" aria-hidden="true" />
                        <p className="text-sm font-medium">The log of this run was removed</p>
                        <p className="max-w-md text-sm text-muted-foreground">
                            Data retention cleared it on <DateDisplay date={run.logsPurgedAt} format="PP" />. Its status, size and times are still kept.
                        </p>
                    </div>
                ) : shown.length === 0 ? (
                    <p className="px-5 py-10 text-center text-sm text-muted-foreground">No step has started yet.</p>
                ) : (
                    <div className="px-5 pt-5 pb-3">
                        <ol>
                            {shown.map((step, index) => (
                                <Section
                                    key={step.name}
                                    run={run}
                                    step={step}
                                    summary={run.summary.find((entry) => entry.step === step.name)}
                                    now={now}
                                    speed={speed}
                                    last={index === shown.length - 1}
                                />
                            ))}
                        </ol>
                        {pending.length > 0 && (
                            <p className="mb-2 ml-7 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                                Then {pending.map((step) => step.name).join(", ")}{pendingMs > 0 ? `, usually ${formatDuration(pendingMs)} together` : ""}
                            </p>
                        )}
                    </div>
                )}
            </ScrollArea>
        </section>
    );
}
