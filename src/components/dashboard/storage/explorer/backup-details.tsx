"use client";

import Link from "next/link";
import { Calendar, Database, Download, FolderOpen, Layers, Lock, RefreshCw, RotateCcw, ShieldCheck, TriangleAlert, Unlink } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { DetailStats, FactList, Section, type DetailStat } from "@/components/adapter/connection-details-sections";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { CopyState, ExplorerDestination, ExplorerFile, ExplorerJob, RunExecution } from "@/services/storage/explorer-types";
import { backupActions, type BackupActionHandlers } from "./backup-actions";
import { BackupRowMenu } from "./backup-menus";
import { AnswerDot, answerOf, AnswerText, DestinationTile, IntegrityBadge, JobTile, TypeChip } from "./explorer-cells";
import { contentsOf, count, madeAt, snapshotBytes, startedBy } from "./explorer-format";

export interface BackupDetailsData {
    /** The copy the panel is about. */
    file: ExplorerFile;
    destinationId: string;
    /** Every copy of the backup, this one included, in the upload order of its job. */
    copies: { destinationId: string; state: CopyState; file?: ExplorerFile }[];
    job: ExplorerJob | null;
    /** The backups of its incremental chain, oldest first, when it is part of one. */
    chain: ExplorerFile[] | null;
    execution: RunExecution | null;
}

interface BackupDetailsProps {
    data: BackupDetailsData;
    destinations: Map<string, ExplorerDestination>;
    /** The actions of one copy, by the destination it lies at. */
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    /** Deletes every copy of the backup, from the list by job. */
    onDeleteEverywhere?: () => void;
    /** Lists a destination again, for a copy whose destination does not answer. */
    onCheckDestination?: (destinationId: string) => void;
    canViewHistory: boolean;
}

const VERIFIED_BY: Record<string, string> = {
    "post-upload": "after the upload",
    manual: "checked by hand",
    scheduled: "by the integrity check task",
};

const COMPRESSION: Record<string, string> = { GZIP: "Gzip", BROTLI: "Brotli", ZSTD: "Zstandard", NONE: "None" };

/** The backups of a chain as boxes: F for the full, the number for each incremental. */
function ChainStrip({ chain, current }: { chain: ExplorerFile[]; current: number }) {
    const pitch = 3.25; // rem between two boxes
    return (
        <div className="shrink-0">
            <div className="relative flex">
                <span
                    className="absolute top-4.5 h-0.5 bg-border"
                    style={{ left: `${pitch / 2}rem`, width: `${pitch * (chain.length - 1)}rem` }}
                    aria-hidden="true"
                />
                {chain.map((member, index) => (
                    <div key={member.path} className="relative flex w-13 flex-col items-center gap-1.5">
                        <span
                            className={cn(
                                "flex size-9 items-center justify-center rounded-lg text-sm font-semibold",
                                index === 0 ? "bg-foreground text-background" : "border bg-muted",
                                index === current && index !== 0 && "border-2 border-foreground ring-4 ring-foreground/10",
                                index === current && index === 0 && "ring-4 ring-foreground/20",
                                index > current && "border-dashed bg-transparent text-muted-foreground"
                            )}
                        >
                            {index === 0 ? "F" : member.chain?.index ?? index}
                        </span>
                        <span className={cn("text-[11px] whitespace-nowrap tabular-nums", index === current ? "font-medium" : "text-muted-foreground")}>
                            <DateDisplay date={madeAt(member)} format="MMM d" />
                        </span>
                    </div>
                ))}
            </div>
            {current > 0 && (
                <div className="mt-2 ml-2" style={{ width: `${pitch * current + 2.25}rem` }}>
                    <div className="h-2 rounded-b-md border border-t-0 border-muted-foreground/60" />
                    <p className="mt-1 text-center text-xs whitespace-nowrap text-muted-foreground">
                        a restore reads these {current + 1}
                    </p>
                </div>
            )}
        </div>
    );
}

function Fact({ icon: Icon, children }: { icon: typeof Layers; children: React.ReactNode }) {
    return (
        <p className="flex gap-2.5 text-sm">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{children}</span>
        </p>
    );
}

function ChainSection({ chain, file }: { chain: ExplorerFile[]; file: ExplorerFile }) {
    const current = Math.max(0, chain.findIndex((member) => member.path === file.path));
    const later = chain.slice(current + 1);
    const readBytes = chain.slice(0, current + 1).reduce((sum, member) => sum + member.size, 0);
    return (
        <Section title="Its chain" aside={<>Chain of <DateDisplay date={madeAt(chain[0])} format="P" /> · {count(chain.length, "backup")}</>}>
            <div className="space-y-3 rounded-lg border p-3">
                {/* A long chain, like an hourly one, scrolls sideways instead of widening the panel. */}
                <ScrollArea horizontal className="max-w-full">
                    <div className="pb-2">
                        <ChainStrip chain={chain} current={current} />
                    </div>
                </ScrollArea>
                <div className="min-w-0 space-y-2">
                    {current === 0 ? (
                        <Fact icon={Layers}>The full backup of the chain. {later.length > 0 ? `The ${count(later.length, "incremental")} after it build on it.` : "Nothing builds on it yet."}</Fact>
                    ) : (
                        <Fact icon={Layers}>A restore reads the full and the incrementals 1 to {current}, {formatBytes(readBytes, 1)} in all.</Fact>
                    )}
                    {later.length > 0 && (
                        <Fact icon={Lock}>
                            {later.length === 1 ? "Incremental" : "Incrementals"} {later.map((member) => member.chain?.index).join(", ")} {later.length === 1 ? "builds" : "build"} on it, so it can only be deleted together with {later.length === 1 ? "it" : "them"}.
                        </Fact>
                    )}
                </div>
            </div>
        </Section>
    );
}

/** Where a restore and a download read from, and whether that works right now. */
function ReadFrom({ here, alternative }: { here: ExplorerDestination; alternative?: string }) {
    const answer = answerOf(here);
    return (
        <p className={cn("flex items-center gap-2 text-xs", answer === "online" ? "text-muted-foreground" : answer === "missed" ? "text-warning" : "text-destructive")}>
            <AnswerDot answer={answer} />
            <span className="min-w-0">
                {answer === "online" && <>Restore and download read from <span className="font-medium text-foreground">{here.name}</span>, which answers right now.</>}
                {answer === "missed" && <>Restore and download read from {here.name}, which missed its last check.</>}
                {answer === "offline" && (alternative
                    ? <>{here.name} is offline. {alternative} holds the same backup and answers right now.</>
                    : <>No copy answers right now. Restore and download fail until {here.name} answers again.</>)}
            </span>
        </p>
    );
}

/** A banner in the look of the job panel: a colored edge, an icon, a title and one line. */
function Banner({ tone, icon: Icon, title, children, action }: { tone: "warning" | "neutral"; icon: typeof Layers; title: string; children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className={cn("relative flex gap-3 overflow-hidden rounded-lg border p-3 pl-4", tone === "warning" ? "border-warning/30 bg-warning/5" : "bg-muted/40")}>
            <span className={cn("absolute inset-y-0 left-0 w-1", tone === "warning" ? "bg-warning" : "bg-muted-foreground/40")} aria-hidden="true" />
            <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground">{children}</p>
                {action}
            </div>
        </div>
    );
}

/** Everything about one backup: its copies, its chain, what it holds and its last check. */
export function BackupDetails({ data, destinations, handlersFor, onDeleteEverywhere, onCheckDestination, canViewHistory }: BackupDetailsProps) {
    const { file, destinationId, copies, job, chain, execution } = data;
    const handlers = handlersFor(file, destinationId);
    const groups = backupActions(file, { ...handlers, onDelete: onDeleteEverywhere ?? handlers.onDelete });
    const missing = copies.filter((copy) => copy.state === "missing");
    const stored = copies.filter((copy) => copy.state === "stored");
    const here = destinations.get(destinationId);
    const answers = (id: string) => {
        const destination = destinations.get(id);
        return destination !== undefined && answerOf(destination) === "online";
    };
    const answering = stored.filter((copy) => answers(copy.destinationId));
    const alternative = answering.find((copy) => copy.destinationId !== destinationId);
    const started = startedBy(file);
    const took = execution?.endedAt ? Date.parse(execution.endedAt) - Date.parse(execution.startedAt) : null;
    const jobName = job?.name ?? file.jobName ?? "Backup";

    const stats: DetailStat[] = [
        { label: "Snapshot", value: formatBytes(snapshotBytes(file), 1), extra: "what a restore brings back" },
        { label: "Stored", value: formatBytes(file.size, 1), extra: snapshotBytes(file) > file.size ? "this archive alone" : "at each destination" },
        took !== null
            ? { label: "Took", value: formatDuration(took), extra: started?.label ?? undefined }
            : { label: "Started by", value: started?.label ?? "-", extra: execution ? undefined : "no run in History" },
    ];

    const inside = file.databases && file.databases.length > 0
        ? file.databases.map((name) => ({ name, detail: file.engineVersion ? `${file.sourceType ?? ""} ${file.engineVersion}`.trim() : file.sourceName ?? "" }))
        : [];
    const folders = file.combined?.directorySources ?? 0;

    const facts = [
        { label: "Compression", value: file.compression ? COMPRESSION[file.compression] ?? file.compression : "None" },
        { label: "Encryption", value: file.isEncrypted ? "Encrypted" : "Not encrypted" },
        ...(file.engineVersion ? [{ label: "Engine", value: `${file.engineEdition ? `${file.engineEdition} ` : ""}${file.engineVersion}` }] : []),
        ...(file.storageClass ? [{ label: "Storage class", value: file.storageClass }] : []),
        { label: "Path", value: <span title={file.path}>{file.path}</span> },
    ];

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    {job ? <JobTile job={job} size="lg" /> : here ? <DestinationTile destination={here} size="lg" /> : null}
                    <div className="min-w-0">
                        <SheetTitle className="truncate text-lg font-semibold">
                            <DateDisplay date={madeAt(file)} format="PPp" />
                        </SheetTitle>
                        <SheetDescription className="truncate text-sm text-muted-foreground" title={file.name}>
                            {jobName} · {file.name}
                        </SheetDescription>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            <TypeChip file={file} />
                            {file.isEncrypted && <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium">Encrypted</span>}
                            {file.locked && <span className="inline-flex h-5 items-center rounded-md bg-warning/10 px-1.5 text-[11px] font-medium text-warning">Locked</span>}
                            {job?.kind === "deleted" && <span className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium">Job deleted</span>}
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {handlers.onRestore && (
                        <Button variant="outline" size="sm" onClick={() => handlers.onRestore?.()}>
                            <RotateCcw />
                            Restore
                        </Button>
                    )}
                    {handlers.onDownload && (
                        <Button variant="outline" size="sm" onClick={() => handlers.onDownload?.(false)}>
                            <Download />
                            Download
                        </Button>
                    )}
                    {handlers.onToggleLock && (
                        <Button variant="outline" size="sm" onClick={handlers.onToggleLock}>
                            <Lock />
                            {file.locked ? "Unlock" : "Lock"}
                        </Button>
                    )}
                    {handlers.onVerify && (
                        <Button variant="outline" size="sm" onClick={handlers.onVerify}>
                            <ShieldCheck />
                            Verify
                        </Button>
                    )}
                    <BackupRowMenu name={file.name} groups={groups} variant="outline" />
                </div>
                {here && <ReadFrom here={here} alternative={alternative ? destinations.get(alternative.destinationId)?.name : undefined} />}
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    {missing.length > 0 && (
                        <Banner
                            tone="warning"
                            icon={TriangleAlert}
                            title={`${missing.length} of ${copies.length} copies ${missing.length === 1 ? "is" : "are"} missing`}
                            action={canViewHistory && execution ? (
                                <Link href={`/dashboard/history?executionId=${execution.id}`} className="inline-block font-medium hover:underline hover:underline-offset-4">
                                    Open the run
                                </Link>
                            ) : undefined}
                        >
                            {execution?.status === "Partial"
                                ? `The run ended as Partial, its upload to ${missing.map((copy) => destinations.get(copy.destinationId)?.name).join(", ")} failed.`
                                : `${missing.map((copy) => destinations.get(copy.destinationId)?.name).join(", ")} ${missing.length === 1 ? "holds" : "hold"} older backups of this job but not this one.`}
                        </Banner>
                    )}
                    {job?.kind === "deleted" && (
                        <Banner tone="neutral" icon={Unlink} title="The job was deleted">
                            Retention stopped with it, so this backup stays until you delete it.
                        </Banner>
                    )}

                    <DetailStats stats={stats} />

                    {chain && chain.length > 1 && <ChainSection chain={chain} file={file} />}

                    <Section title="Stored at" aside={stored.length > 0 ? `${answering.length} of ${stored.length} answering right now` : undefined}>
                        <ul className="divide-y rounded-lg border">
                            {copies.map((copy) => {
                                const destination = destinations.get(copy.destinationId);
                                const copyFile = copy.file;
                                const copyHandlers = copyFile ? handlersFor(copyFile, copy.destinationId) : null;
                                const offline = copy.state === "stored" && destination !== undefined && answerOf(destination) === "offline";
                                return (
                                    <li key={copy.destinationId} className={cn("flex items-center gap-3 px-3 py-2", copy.state === "missing" && "bg-warning/5")}>
                                        {destination ? <DestinationTile destination={destination} /> : <span className="size-8" />}
                                        <div className="min-w-0 flex-1">
                                            <span className="flex items-center gap-2 text-sm font-medium">
                                                <span className="truncate">{destination?.name ?? "Removed destination"}</span>
                                                {copy.state === "missing" && (
                                                    <span className="inline-flex h-5 shrink-0 items-center rounded-md border border-dashed border-warning/60 px-1.5 text-[11px] font-medium text-warning">Missing</span>
                                                )}
                                                {copy.destinationId === destinationId && stored.length > 1 && (
                                                    <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] font-medium">Shown here</span>
                                                )}
                                                {copy.state === "stored" && destination && <AnswerText destination={destination} />}
                                            </span>
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {copy.state === "missing"
                                                    ? "Not at this destination"
                                                    : copyFile?.verification?.passed
                                                        ? <>Verified <DateDisplay date={copyFile.verification.verifiedAt} format="Pp" /></>
                                                        : copyFile?.verification ? "Check failed" : "Not checked"}
                                                {offline ? " · a restore from here fails" : copy.state === "stored" && destination?.listError ? " · its list is old" : ""}
                                            </span>
                                        </div>
                                        {offline && onCheckDestination ? (
                                            <Button variant="outline" size="sm" className="h-7" onClick={() => onCheckDestination(copy.destinationId)}>
                                                <RefreshCw />
                                                Check now
                                            </Button>
                                        ) : copyHandlers?.onDownload && (
                                            <Button variant="ghost" className="size-8 p-0" onClick={() => copyHandlers.onDownload?.(false)} aria-label={`Download from ${destination?.name ?? "this destination"}`}>
                                                <Download />
                                            </Button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </Section>

                    <Section title="What is inside" aside={contentsOf(file)}>
                        <ul className="divide-y rounded-lg border">
                            {inside.map((entry) => (
                                <li key={entry.name} className="flex items-center gap-3 px-3 py-2">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                                        {file.sourceType ? <AdapterIcon adapterId={file.sourceType} className="size-4" /> : <Database className="size-4 text-muted-foreground" />}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{entry.name}</span>
                                        {entry.detail && <span className="block truncate text-xs text-muted-foreground">{entry.detail}</span>}
                                    </div>
                                </li>
                            ))}
                            {inside.length === 0 && (
                                <li className="flex items-center gap-3 px-3 py-2">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                                        {file.sourceType && file.sourceType !== "directory-only" ? <AdapterIcon adapterId={file.sourceType} className="size-4" /> : <FolderOpen className="size-4 text-muted-foreground" />}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm">{contentsOf(file)}</span>
                                </li>
                            )}
                            {folders > 0 && inside.length > 0 && (
                                <li className="flex items-center gap-3 px-3 py-2">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                                        <FolderOpen className="size-4 text-muted-foreground" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm">{count(folders, "folder")}</span>
                                </li>
                            )}
                        </ul>
                    </Section>

                    <Section title="Integrity">
                        <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
                            <div className="min-w-0 flex-1">
                                <IntegrityBadge verification={file.verification} />
                                {file.verification && (
                                    <span className="block text-xs text-muted-foreground">
                                        <DateDisplay date={file.verification.verifiedAt} format="Pp" /> · {VERIFIED_BY[file.verification.trigger] ?? "checked"}
                                    </span>
                                )}
                            </div>
                            {handlers.onVerify && (
                                <Button variant="ghost" size="sm" onClick={handlers.onVerify}>
                                    {file.verification ? "Verify again" : "Verify"}
                                </Button>
                            )}
                        </div>
                    </Section>

                    <Section title="More">
                        <FactList facts={facts} />
                    </Section>

                    {execution && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="size-3.5" aria-hidden="true" />
                            Made by the run of <DateDisplay date={execution.startedAt} format="Pp" />
                            {canViewHistory && (
                                <Link href={`/dashboard/history?executionId=${execution.id}`} className="font-medium text-foreground hover:underline hover:underline-offset-4">
                                    Open the run
                                </Link>
                            )}
                        </p>
                    )}
                </div>
            </ScrollArea>
        </>
    );
}

interface BackupDetailsSheetProps extends Omit<BackupDetailsProps, "data"> {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    data: BackupDetailsData | null;
    onClose: () => void;
}

/** The details of one backup in a panel from the right, for both lists. */
export function BackupDetailsSheet({ open, data, onClose, ...props }: BackupDetailsSheetProps) {
    return (
        <Sheet open={open && data !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {data && <BackupDetails data={data} {...props} />}
            </SheetContent>
        </Sheet>
    );
}
