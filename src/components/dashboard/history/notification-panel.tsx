"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleCheck, CircleX, XCircle } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Banner } from "@/components/dashboard/storage/explorer/backup-details";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DateDisplay } from "@/components/utils/date-display";
import type { RunRow } from "@/services/history/run-types";
import { ChannelTile, EventChip, SentBadge } from "./notification-cells";
import { NotificationPreview } from "./notification-preview";
import type { NotificationLogRow } from "./notification-types";
import { RunTile } from "./run-cells";
import { runHref } from "./run-links";

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
    return (
        <section className="border-t px-5 py-4">
            <div className="mb-3 flex items-baseline gap-3">
                <h3 className="text-sm font-semibold">{title}</h3>
                {aside && <span className="ml-auto text-xs text-muted-foreground">{aside}</span>}
            </div>
            {children}
        </section>
    );
}

/** The run a notification was sent for, and the other channels that got the same message. */
function useRunOf(entry: NotificationLogRow | null) {
    const [run, setRun] = useState<RunRow | null>(null);
    const [siblings, setSiblings] = useState<NotificationLogRow[]>([]);
    const executionId = entry?.executionId ?? null;
    useEffect(() => {
        setRun(null);
        setSiblings([]);
        if (!executionId) return;
        let cancelled = false;
        void fetch(`/api/history/runs/${encodeURIComponent(executionId)}?row=1`)
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => { if (!cancelled && body?.success) setRun(body.data as RunRow); })
            .catch(() => undefined);
        void fetch(`/api/notification-logs?executionId=${encodeURIComponent(executionId)}&pageSize=50`)
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => { if (!cancelled && Array.isArray(body?.data)) setSiblings(body.data as NotificationLogRow[]); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [executionId]);
    return { run, siblings: siblings.filter((sibling) => sibling.eventType === entry?.eventType) };
}

/** One notification in the side panel: what went out, whether the channel took it and the run it was for. */
export function NotificationPanel({ entry, onClose }: { entry: NotificationLogRow | null; onClose: () => void }) {
    const { run, siblings } = useRunOf(entry);
    return (
        <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {entry && (
                    <ScrollArea className="min-h-0 flex-1">
                        <div className="flex gap-3 px-5 pt-5 pb-4 pr-12">
                            <ChannelTile adapterId={entry.adapterId} size="lg" />
                            <div className="min-w-0 space-y-1">
                                <SheetTitle className="text-lg leading-tight">{entry.title}</SheetTitle>
                                <SheetDescription className="truncate">
                                    {entry.channelName} · <DateDisplay date={entry.sentAt} format="PPpp" />
                                </SheetDescription>
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    <EventChip eventType={entry.eventType} />
                                    <SentBadge ok={entry.status === "Success"} />
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 px-5 pb-4">
                            {entry.executionId && (
                                <Button variant="outline" size="sm" asChild>
                                    <Link href={runHref(entry.executionId)}><ArrowUpRight />Open run</Link>
                                </Button>
                            )}
                            <Button variant="outline" size="sm" asChild>
                                <Link href="/dashboard/connections?tab=notifications"><ArrowUpRight />Open channel</Link>
                            </Button>
                        </div>
                        {entry.status === "Failed" && (
                            <div className="px-5 pb-4">
                                <Banner tone="destructive" icon={XCircle} title={`${entry.channelName} did not take it`}>
                                    <span className="font-mono text-xs break-words">{entry.error ?? "The channel answered with an error."}</span>
                                </Banner>
                            </div>
                        )}
                        <Section title="What was sent" aside="as the channel shows it">
                            <NotificationPreview entry={entry} />
                        </Section>
                        {entry.executionId && (
                            <Section title="Sent for">
                                <div className="flex items-center gap-3">
                                    {run ? <RunTile row={run} /> : <span className="size-8 rounded-lg border bg-muted/50" aria-hidden="true" />}
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{run?.name ?? "A run"}</p>
                                        <p className="truncate text-xs text-muted-foreground">{run ? <><DateDisplay date={run.startedAt} format="Pp" /> · {run.sub}</> : " "}</p>
                                    </div>
                                    {run && <ExecutionStatusBadge status={run.status} />}
                                </div>
                            </Section>
                        )}
                        {siblings.length > 1 && (
                            <Section title="The same message" aside={`to ${siblings.length} channels`}>
                                <div className="flex flex-wrap gap-2">
                                    {siblings.map((sibling) => (
                                        <span key={sibling.id} className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm">
                                            {sibling.status === "Success"
                                                ? <CircleCheck className="size-3.5 text-success" aria-label="Sent" />
                                                : <CircleX className="size-3.5 text-destructive" aria-label="Failed" />}
                                            <AdapterIcon adapterId={sibling.adapterId} className="size-3.5" />
                                            {sibling.channelName}
                                        </span>
                                    ))}
                                </div>
                            </Section>
                        )}
                    </ScrollArea>
                )}
            </SheetContent>
        </Sheet>
    );
}
