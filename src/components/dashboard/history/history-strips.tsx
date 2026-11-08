"use client";

import { CircleCheck, CircleX, LoaderCircle, MessageSquare, ScrollText, Send, TriangleAlert, Zap } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { successShare } from "@/lib/core/success-share";
import type { NotificationStats } from "@/services/notifications/notification-log-service";
import type { RunStats } from "@/services/history/run-types";

/** A number that is still on its way, so the tile does not read as none. */
const LOADING = <Skeleton className="inline-block h-4 w-10 align-middle" />;

/** The numbers above the runs: the last 30 days, and what runs and waits right now. */
export function RunsStrip({ stats }: { stats: RunStats | null }) {
    const live = stats ? stats.running.length + stats.queued.length : 0;
    const liveText = !stats || live === 0
        ? "nothing runs right now"
        : [stats.running[0] && `${stats.running[0]} runs`, stats.queued[0] && `${stats.queued[0]} waits`].filter(Boolean).join(", ");
    // Of the runs that finished, like every success share of the app, see success-share.ts.
    const share = stats ? successShare(stats) : null;
    const finished = stats ? stats.succeeded + stats.partial + stats.failed : 0;
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Runs", icon: ScrollText, value: stats ? stats.total.toLocaleString() : LOADING, extra: "in the last 30 days" },
                { label: "Succeeded", icon: CircleCheck, value: share !== null ? share.toLocaleString() : stats ? "-" : LOADING, unit: share !== null ? "%" : undefined, tone: share === 100 ? "success" : undefined, extra: stats ? `${stats.succeeded.toLocaleString()} of ${finished.toLocaleString()} finished runs` : " " },
                {
                    label: "Failed",
                    icon: CircleX,
                    value: stats ? stats.failed.toLocaleString() : LOADING,
                    tone: stats && stats.failed > 0 ? "destructive" : undefined,
                    extra: stats?.lastFailed ? <>the last <RelativeTime date={stats.lastFailed.at} />, {stats.lastFailed.name}</> : "none in 30 days",
                },
                {
                    label: "Partial",
                    icon: TriangleAlert,
                    value: stats ? stats.partial.toLocaleString() : LOADING,
                    tone: stats && stats.partial > 0 ? "warning" : undefined,
                    extra: stats?.lastPartial ? `a copy is missing, the last ${stats.lastPartial.name}` : "every copy stored",
                },
                { label: "Running", icon: LoaderCircle, value: stats ? live.toLocaleString() : LOADING, extra: liveText },
            ]}
        />
    );
}

/** The numbers above the notifications, over the last 30 days. */
export function NotificationsStrip({ stats }: { stats: NotificationStats | null }) {
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Sent", icon: Send, value: stats ? stats.sent.toLocaleString() : LOADING, extra: "in the last 30 days" },
                {
                    label: "Failed",
                    icon: CircleX,
                    value: stats ? stats.failed.toLocaleString() : LOADING,
                    tone: stats && stats.failed > 0 ? "destructive" : undefined,
                    extra: stats?.lastFailed ? <>the last to {stats.lastFailed.channelName}, <RelativeTime date={stats.lastFailed.at} /></> : "every message went out",
                },
                { label: "Channels", icon: MessageSquare, value: stats ? stats.channels.length.toLocaleString() : LOADING, extra: stats && stats.channels.length > 0 ? stats.channels.join(", ") : "none sent in 30 days" },
                { label: "Events", icon: Zap, value: stats ? stats.events.toLocaleString() : LOADING, extra: "kinds of message sent" },
            ]}
        />
    );
}
