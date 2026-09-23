import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import type { DashboardKpis } from "@/services/dashboard/types";
import { Sparkline } from "./sparkline";

interface KpiCardsProps {
    kpis: DashboardKpis;
    /** Link targets, left out when the user may not open the page. */
    historyHref?: string;
    storageHref?: string;
}

interface KpiCardProps {
    label: string;
    href?: string;
    value: string;
    unit?: string;
    valueClassName?: string;
    note: React.ReactNode;
    trend: (number | null)[];
    trendClassName: string;
    trendFromZero?: boolean;
}

const cardClassName = "group flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5";

function KpiCard({ label, href, value, unit, valueClassName, note, trend, trendClassName, trendFromZero }: KpiCardProps) {
    const body = (
        <>
            <div className="flex items-start justify-between gap-2">
                <span className="truncate text-sm text-muted-foreground">{label}</span>
                {href && (
                    <ArrowUpRight
                        className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                        aria-hidden="true"
                    />
                )}
            </div>
            <div className="flex min-w-0 items-baseline gap-1.5">
                <span className={cn("truncate text-2xl font-semibold tracking-tight tabular-nums md:text-3xl", valueClassName)}>
                    {value}
                </span>
                {unit && <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{unit}</span>}
            </div>
            <div className="flex min-w-0 items-center gap-1 text-xs">{note}</div>
            <Sparkline values={trend} className={cn("mt-auto pt-1", trendClassName)} fromZero={trendFromZero} />
        </>
    );

    if (!href) return <div className={cardClassName}>{body}</div>;
    return (
        <Link
            href={href}
            className={cn(cardClassName, "outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50")}
        >
            {body}
        </Link>
    );
}

function Note({ children, tone = "muted", icon }: { children: React.ReactNode; tone?: "muted" | "up" | "down"; icon?: React.ReactNode }) {
    return (
        <span
            className={cn(
                "flex min-w-0 items-center gap-1",
                tone === "muted" && "text-muted-foreground",
                tone === "up" && "text-success",
                tone === "down" && "text-destructive"
            )}
        >
            {icon}
            <span className="truncate">{children}</span>
        </span>
    );
}

function formatPercent(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function signed(value: string, negative: boolean): string {
    return `${negative ? "-" : "+"}${value}`;
}

function SuccessRateNote({ value, previous }: DashboardKpis["successRate"]) {
    if (value === null || previous === null) return <Note>No runs in the 30 days before</Note>;

    const diff = Math.round((value - previous) * 10) / 10;
    if (diff === 0) return <Note icon={<Minus className="size-3.5" aria-hidden="true" />}>Same as the prior 30 days</Note>;

    const Icon = diff > 0 ? TrendingUp : TrendingDown;
    return (
        <Note tone={diff > 0 ? "up" : "down"} icon={<Icon className="size-3.5" aria-hidden="true" />}>
            {signed(formatPercent(Math.abs(diff)), diff < 0)} vs prior 30 days
        </Note>
    );
}

function WeeklyChange({ change, format, fallback }: { change: number | null; format: (n: number) => string; fallback: string }) {
    if (change === null) return <Note>{fallback}</Note>;
    if (change === 0) return <Note>No change this week</Note>;
    return <Note>{signed(format(Math.abs(change)), change < 0)} this week</Note>;
}

/** The four headline numbers, each with its trend over the last days. */
export function KpiCards({ kpis, historyHref, storageHref }: KpiCardsProps) {
    const { successRate, backupsStored, storageUsed, failedRuns24h } = kpis;
    const [storageValue, storageUnit] = formatBytes(storageUsed.value, 1).split(" ");
    const destinations = `Across ${backupsStored.destinations} destination${backupsStored.destinations === 1 ? "" : "s"}`;

    return (
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <KpiCard
                label="Success rate, 30 days"
                href={historyHref}
                value={successRate.value === null ? "-" : formatPercent(successRate.value)}
                unit={successRate.value === null ? undefined : "%"}
                note={<SuccessRateNote {...successRate} />}
                trend={successRate.trend}
                trendClassName="text-success"
            />
            <KpiCard
                label="Backups stored"
                href={storageHref}
                value={backupsStored.value.toLocaleString()}
                note={
                    <WeeklyChange
                        change={backupsStored.weekAgo === null ? null : backupsStored.value - backupsStored.weekAgo}
                        format={(n) => n.toLocaleString()}
                        fallback={destinations}
                    />
                }
                trend={backupsStored.trend}
                trendClassName="text-muted-foreground"
            />
            <KpiCard
                label="Storage used"
                href={storageHref}
                value={storageValue}
                unit={storageUnit}
                note={
                    <WeeklyChange
                        change={storageUsed.weekAgo === null ? null : storageUsed.value - storageUsed.weekAgo}
                        format={(n) => formatBytes(n, 1)}
                        fallback={destinations}
                    />
                }
                trend={storageUsed.trend}
                trendClassName="text-muted-foreground"
            />
            <KpiCard
                label="Failed runs, 24h"
                href={historyHref}
                value={failedRuns24h.value.toLocaleString()}
                unit={`of ${failedRuns24h.total.toLocaleString()}`}
                valueClassName={failedRuns24h.value > 0 ? "text-destructive" : undefined}
                note={
                    <Note tone={failedRuns24h.value > 0 ? "down" : "muted"}>
                        {failedRuns24h.lastFailureAt
                            ? `Last failure ${formatDistanceToNowStrict(new Date(failedRuns24h.lastFailureAt), { addSuffix: true })}`
                            : "No failures on record"}
                    </Note>
                }
                trend={failedRuns24h.trend}
                trendClassName="text-destructive"
                trendFromZero
            />
        </div>
    );
}
