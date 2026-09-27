"use client";

import { CircleCheck, CircleDashed, CircleX, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatDuration } from "@/lib/utils";
import type { RunDetail, RunStep, RunStepState, RunUpload } from "@/services/history/run-types";
import { LiveBar } from "./run-cells";
import { RunningIcon } from "./run-live";

export function StepIcon({ state, className }: { state: RunStepState; className?: string }) {
    if (state === "running") return <RunningIcon className={className} />;
    const Icon = state === "done" ? CircleCheck : state === "warning" ? TriangleAlert : state === "failed" ? CircleX : CircleDashed;
    const tone = state === "done" ? "text-success" : state === "warning" ? "text-warning" : state === "failed" ? "text-destructive" : "text-muted-foreground/60";
    return <Icon className={cn("size-4 shrink-0", tone, className)} aria-hidden="true" />;
}

export function ProblemBadges({ errors, warnings }: { errors: number; warnings: number }) {
    return (
        <>
            {errors > 0 && (
                <span className="inline-flex h-4.5 items-center gap-1 rounded-full bg-destructive/12 px-1.5 text-[11px] font-semibold text-destructive">
                    <CircleX className="size-3" aria-hidden="true" />{errors}<span className="sr-only">{errors === 1 ? "error" : "errors"}</span>
                </span>
            )}
            {warnings > 0 && (
                <span className="inline-flex h-4.5 items-center gap-1 rounded-full bg-warning/12 px-1.5 text-[11px] font-semibold text-warning">
                    <TriangleAlert className="size-3" aria-hidden="true" />{warnings}<span className="sr-only">{warnings === 1 ? "warning" : "warnings"}</span>
                </span>
            )}
        </>
    );
}

function noteOf(step: RunStep, run: RunDetail): string | null {
    if (step.state === "skipped") return "skipped";
    if (step.state === "pending") return "next";
    if (step.name === "Dumping Databases" && run.databases.length > 0) return `${run.databases.length} ${run.databases.length === 1 ? "database" : "databases"}`;
    if (step.name === "Uploading" && run.uploads.length > 0) return `${run.uploads.filter((upload) => upload.state === "done").length} of ${run.uploads.length} stored`;
    if (step.name === "Sending Notifications" && run.notifications.length > 0) return `${run.notifications.filter((entry) => entry.status === "Success").length} of ${run.notifications.length} sent`;
    return null;
}

function uploadText(upload: RunUpload): string {
    if (upload.state === "failed") return upload.error ?? "failed";
    if (upload.state === "waiting") return "waits";
    if (upload.state === "uploading") return upload.bytes !== null && upload.total ? `${Math.round((upload.bytes / upload.total) * 100)} %` : "starting";
    if (upload.startedAt && upload.endedAt) return `stored in ${formatDuration(Date.parse(upload.endedAt) - Date.parse(upload.startedAt))}`;
    return upload.state === "done" ? "stored" : "skipped";
}

function SubLine({ adapterId, name, text, state, share }: { adapterId: string; name: string; text: string; state: "done" | "failed" | "running" | "waiting"; share?: number | null }) {
    const icon: RunStepState = state === "done" ? "done" : state === "failed" ? "failed" : state === "running" ? "running" : "pending";
    return (
        <div className="py-1.5 pr-2.5 pl-9">
            <div className="flex min-w-0 items-center gap-2 text-sm">
                <StepIcon state={icon} className="size-3.5" />
                <AdapterIcon adapterId={adapterId} className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{name}</span>
                <span className={cn("ml-auto max-w-[55%] shrink-0 truncate text-xs", state === "failed" ? "text-destructive" : "text-muted-foreground")} title={text}>{text}</span>
            </div>
            {state === "running" && <LiveBar percent={share ?? null} className="mt-1.5 ml-5.5" />}
        </div>
    );
}

interface StepsPaneProps {
    run: RunDetail;
    now: number;
    picked: string | null;
    onPick: (step: string | null) => void;
    className?: string;
}

/** The steps of a run with their time next to the usual one, every copy and every notification under its step. */
export function StepsPane({ run, now, picked, onPick, className }: StepsPaneProps) {
    const shown = run.steps.filter((step) => step.state !== "skipped" || step.lines.length > 0 || run.status !== "Success");
    const took = run.durationMs !== null ? formatDuration(run.durationMs) : null;
    return (
        <section aria-label="Steps" className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
            <div className="px-5 pt-4 pb-3">
                <h2 className="font-semibold">Steps</h2>
                <p className="text-sm text-muted-foreground">{took ? `${shown.length} steps in ${took}, a click shows the lines of one` : "time taken / usual, a click shows the lines of one"}</p>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-0.5 px-2.5 pb-3">
                    {shown.map((step) => {
                        const duration = step.state === "running" && step.startedAt ? now - Date.parse(step.startedAt) : step.durationMs;
                        const note = noteOf(step, run);
                        const active = picked === step.name;
                        return (
                            <div key={step.name}>
                                <button
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => onPick(active ? null : step.name)}
                                    className={cn(
                                        "flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                                        active ? "border-border bg-muted/50" : "border-transparent"
                                    )}
                                >
                                    <StepIcon state={step.state} />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                            <span className={cn("truncate text-sm font-medium", (step.state === "pending" || step.state === "skipped") && "text-muted-foreground")}>{step.name}</span>
                                            <ProblemBadges errors={step.errors} warnings={step.warnings} />
                                        </span>
                                        {note && <span className="block truncate text-xs text-muted-foreground">{note}</span>}
                                    </span>
                                    <span className="shrink-0 text-right text-sm tabular-nums">
                                        {duration !== null ? formatDuration(Math.max(0, duration)) : ""}
                                        {step.usualMs !== null && <span className="text-xs text-muted-foreground">{duration !== null ? " / " : "usual "}{formatDuration(step.usualMs)}</span>}
                                    </span>
                                </button>
                                {step.name === "Uploading" && run.uploads.map((upload) => (
                                    <SubLine
                                        key={upload.configId}
                                        adapterId={upload.adapterId}
                                        name={upload.name}
                                        text={uploadText(upload)}
                                        state={upload.state === "uploading" ? "running" : upload.state === "done" ? "done" : upload.state === "failed" ? "failed" : "waiting"}
                                        share={upload.bytes !== null && upload.total ? Math.round((upload.bytes / upload.total) * 100) : null}
                                    />
                                ))}
                                {step.name === "Sending Notifications" && run.notifications.map((entry) => (
                                    <SubLine key={entry.id} adapterId={entry.adapterId} name={entry.channelName} text={entry.status === "Success" ? "sent" : entry.error ?? "failed"} state={entry.status === "Success" ? "done" : "failed"} />
                                ))}
                            </div>
                        );
                    })}
                </div>
            </ScrollArea>
        </section>
    );
}
