"use client";

import { CircleX, Clock, ClockAlert, FolderOpen, KeyRound, Layers, Lock, MousePointerClick, Settings2, ShieldCheck, Unlink, Unplug } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import type { CopyState, ExplorerDestination, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import { isIncremental, madeAt, snapshotBytes, startedBy, typeLabel } from "./explorer-format";
import { answerOf, isStale, type Answer } from "./explorer-state";

export { answerOf, isStale, type Answer };

const TILE = "flex shrink-0 items-center justify-center rounded-lg border bg-muted/50";

/** The logo of what a job backs up: its database, its folders, or what stands in for a job. */
export function JobIcon({ job, className }: { job: Pick<ExplorerJob, "kind" | "sourceType" | "hasFolders">; className?: string }) {
    if (job.kind === "system") return <Settings2 className={cn("text-muted-foreground", className)} />;
    if (job.kind === "none") return <Unlink className={cn("text-muted-foreground", className)} />;
    if (job.sourceType) return <AdapterIcon adapterId={job.sourceType} className={className} />;
    return <FolderOpen className={cn("text-muted-foreground", className)} />;
}

export function JobTile({ job, size = "md" }: { job: Pick<ExplorerJob, "kind" | "sourceType" | "hasFolders">; size?: "sm" | "md" | "lg" }) {
    const box = size === "lg" ? "size-10" : size === "md" ? "size-8" : "size-7";
    const icon = size === "lg" ? "size-5" : "size-4";
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            <JobIcon job={job} className={icon} />
        </span>
    );
}

export function DestinationTile({ destination, size = "md" }: { destination: Pick<ExplorerDestination, "adapterId">; size?: "sm" | "md" | "lg" }) {
    const box = size === "lg" ? "size-10" : size === "md" ? "size-8" : "size-7";
    const icon = size === "lg" ? "size-5" : "size-4";
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            <AdapterIcon adapterId={destination.adapterId} className={icon} />
        </span>
    );
}


const ANSWER_DOT: Record<Exclude<Answer, "away">, string> = { online: "bg-success", missed: "bg-warning", offline: "bg-destructive" };

/** The state of a destination as a dot in its color, or the plug of an air-gapped one that is away. */
export function AnswerDot({ answer }: { answer: Answer }) {
    if (answer === "away") return <Unplug className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />;
    return <span className={cn("size-1.5 shrink-0 rounded-full", ANSWER_DOT[answer])} aria-hidden="true" />;
}

const ANSWER_TEXT: Record<Answer, string> = { online: "text-success", missed: "text-warning", offline: "text-destructive", away: "text-muted-foreground" };

/** Whether a destination answers right now, as the connection check last saw it, with the time it took or since when it does not. */
export function AnswerText({ destination, className }: { destination: ExplorerDestination; className?: string }) {
    const answer = answerOf(destination);
    const { latencyMs, answeredAt } = destination.health;
    return (
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", ANSWER_TEXT[answer], className)}>
            <AnswerDot answer={answer} />
            {answer === "online" && `Online${latencyMs !== null ? ` · ${latencyMs} ms` : ""}`}
            {answer === "missed" && "Missed its last check"}
            {answer === "offline" && (answeredAt ? <>Offline since <DateDisplay date={answeredAt} format="Pp" /></> : "Offline")}
            {answer === "away" && (answeredAt ? <>Not connected · since <DateDisplay date={answeredAt} format="Pp" /></> : "Not connected")}
        </span>
    );
}

/** What the dot and the clock on a copy mean, under the toolbar of a list that shows copies. The plug only shows with an air-gapped destination. */
export function AnswerLegend({ airGapped = false }: { airGapped?: boolean }) {
    return (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><AnswerDot answer="online" />Answers right now</span>
            <span className="inline-flex items-center gap-1.5"><AnswerDot answer="missed" />Missed its last check</span>
            <span className="inline-flex items-center gap-1.5"><AnswerDot answer="offline" />Offline, a restore from it fails</span>
            {airGapped && <span className="inline-flex items-center gap-1.5"><AnswerDot answer="away" />Air-gapped, not connected</span>}
            <span className="inline-flex items-center gap-1.5"><ClockAlert className="size-3.5 text-warning" aria-hidden="true" />Its list is old</span>
        </p>
    );
}

const ANSWER_TONES: Record<Exclude<Answer, "away">, "success" | "warning" | "destructive"> = { online: "success", missed: "warning", offline: "destructive" };
const ANSWER_WORDS: Record<Answer, string> = { online: "answers right now", missed: "missed its last check", offline: "is offline", away: "is not connected" };

/** The state of a destination in words, for the hover of a copy. */
function AnswerTip({ destination, alternative }: { destination: ExplorerDestination; alternative?: string }) {
    const answer = answerOf(destination);
    const { health } = destination;
    // A long name gives way, so the state after it always shows.
    const head = (
        <span className="flex min-w-0 gap-1">
            <span className="truncate">{destination.name}</span> <span className="shrink-0">{ANSWER_WORDS[answer]}</span>
        </span>
    );
    return (
        <>
            {answer === "away" ? (
                // Away is how an air-gapped destination is meant to be, so its head stays neutral.
                <div className="-mx-3 -mt-2 mb-1.5 flex min-w-0 items-center gap-2 rounded-t-[7px] border-b px-3 py-1.5 font-semibold">
                    <AnswerDot answer="away" />
                    {head}
                </div>
            ) : (
                <TooltipHead tone={ANSWER_TONES[answer]}>{head}</TooltipHead>
            )}
            <div className="space-y-1 text-muted-foreground">
                {answer === "online" && (
                    <p>
                        {health.latencyMs !== null ? `It answered in ${health.latencyMs} ms` : "It answered"}
                        {health.checkedAt && <>, <RelativeTime date={health.checkedAt} /></>}.
                    </p>
                )}
                {answer === "missed" && <p>A restore or download of this copy may fail until it answers again.</p>}
                {answer === "away" && (
                    <p>
                        It is air-gapped{health.answeredAt && <> and was last connected <DateDisplay date={health.answeredAt} format="Pp" /></>}. Connect it to restore or download this copy.
                        {alternative && ` ${alternative} holds the same backup and answers right now.`}
                    </p>
                )}
                {answer === "offline" && (
                    <>
                        <p>{health.answeredAt ? <>No answer since <DateDisplay date={health.answeredAt} format="Pp" />.</> : "No answer in the checks DBackup keeps."}</p>
                        <p>A restore or download of this copy fails until it answers.{alternative && ` ${alternative} holds the same backup and answers right now.`}</p>
                    </>
                )}
                {destination.listError && answer !== "offline" && answer !== "away" && (
                    <p>Its last listing failed{destination.listedAt && <>, so this is its list of <DateDisplay date={destination.listedAt} format="Pp" /></>}.</p>
                )}
            </div>
        </>
    );
}

interface CopyChipProps {
    destination: ExplorerDestination | undefined;
    state: CopyState;
    /** Another destination that holds the same backup and answers right now, for the hover of one that does not. */
    alternative?: string;
}

/**
 * One destination a backup lies at, or should: a quiet chip with a dot for whether the destination
 * answers right now, dashed amber when the copy is missing. A clock marks a list that is old.
 */
export function CopyChip({ destination, state, alternative }: CopyChipProps) {
    const name = destination?.name ?? "Removed destination";
    if (state === "missing") {
        return (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-dashed border-warning/60 px-2 text-xs font-medium whitespace-nowrap text-warning">
                {destination && <AdapterIcon adapterId={destination.adapterId} className="size-3.5" />}
                {name} missing
            </span>
        );
    }
    const answer = destination ? answerOf(destination) : null;
    const listOld = destination !== undefined && destination.listError !== null && answer !== "offline" && answer !== "away";
    // A copy at an air-gapped destination that is away is grayed out, it reads once that is connected.
    const away = answer === "away";
    const chip = (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium whitespace-nowrap">
            {answer && <AnswerDot answer={answer} />}
            {destination && <AdapterIcon adapterId={destination.adapterId} className={cn("size-3.5", away && "opacity-50 grayscale")} />}
            <span className={cn((answer === "offline" || away) && "text-muted-foreground")}>{name}</span>
            {answer === "offline" && <span className="text-[11px] text-destructive">offline</span>}
            {listOld && <ClockAlert className="size-3.5 text-warning" aria-label="Its list is old" />}
        </span>
    );
    if (!destination) return chip;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{chip}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
                <AnswerTip destination={destination} alternative={alternative} />
            </TooltipContent>
        </Tooltip>
    );
}

/** Every destination of a backup, in the upload order of its job. */
export function CopyChips({ copies, destinations, empty = "Only here" }: {
    copies: { destinationId: string; state: CopyState }[];
    destinations: Map<string, ExplorerDestination>;
    empty?: string;
}) {
    if (copies.length === 0) return <span className="text-sm text-muted-foreground">{empty}</span>;
    const answering = copies.find((copy) => {
        const destination = destinations.get(copy.destinationId);
        return copy.state === "stored" && destination !== undefined && answerOf(destination) === "online";
    });
    const alternative = answering ? destinations.get(answering.destinationId)?.name : undefined;
    return (
        <span className="flex flex-wrap gap-1.5">
            {copies.map((copy) => (
                <CopyChip
                    key={copy.destinationId}
                    destination={destinations.get(copy.destinationId)}
                    state={copy.state}
                    alternative={copy.destinationId === answering?.destinationId ? undefined : alternative}
                />
            ))}
        </span>
    );
}

/** The last integrity check of a backup. */
export function IntegrityBadge({ verification }: { verification: ExplorerFile["verification"] }) {
    if (!verification) return <span className="text-xs text-muted-foreground">Not checked</span>;
    if (!verification.passed) {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-destructive">
                <CircleX className="size-3.5" aria-hidden="true" />
                Check failed
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            Verified
        </span>
    );
}

const STARTED_BY_ICONS = { schedule: Clock, api: KeyRound, manual: MousePointerClick };

export function StartedBy({ file }: { file: Pick<ExplorerFile, "trigger"> }) {
    const started = startedBy(file);
    if (!started) return <span className="text-sm text-muted-foreground">-</span>;
    const Icon = STARTED_BY_ICONS[started.kind];
    return (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{started.label}</span>
        </span>
    );
}

export function TypeChip({ file }: { file: Pick<ExplorerFile, "backupType" | "chain"> }) {
    return (
        <span className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] font-medium whitespace-nowrap">
            {isIncremental(file) && <Layers className="size-3 text-muted-foreground" aria-hidden="true" />}
            {typeLabel(file)}
        </span>
    );
}

/** Locked and encrypted, as two small icons. */
export function BackupFlags({ file }: { file: Pick<ExplorerFile, "locked" | "isEncrypted"> }) {
    return (
        <span className="flex items-center gap-2">
            {file.locked && (
                <Lock className="size-3.5 text-warning" aria-label="Locked, retention leaves it alone" />
            )}
            {file.isEncrypted && <KeyRound className="size-3.5 text-muted-foreground" aria-label="Encrypted" />}
        </span>
    );
}

/** The snapshot size of a backup, with what the archive stores under it for an incremental. */
export function SizeCell({ file }: { file: Pick<ExplorerFile, "size" | "logicalSize"> }) {
    const snapshot = snapshotBytes(file);
    return (
        <div className="text-right tabular-nums">
            <div className="text-sm font-medium">{formatBytes(snapshot)}</div>
            {snapshot > file.size && <div className="text-xs text-muted-foreground">{formatBytes(file.size)} stored</div>}
        </div>
    );
}

/** When a backup was made, and how long ago. */
export function MadeAt({ file, sub }: { file: Pick<ExplorerFile, "createdAt" | "lastModified">; sub?: React.ReactNode }) {
    const date = madeAt(file);
    return (
        <div className="min-w-0">
            <div className="truncate text-sm font-medium">
                <DateDisplay date={date} format="Pp" />
            </div>
            <div className="truncate text-xs text-muted-foreground">
                <RelativeTime date={date} />
                {sub && <> · {sub}</>}
            </div>
        </div>
    );
}
