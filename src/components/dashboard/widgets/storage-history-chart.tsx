"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { formatBytes } from "@/lib/utils";
import { byteTicks, dayTicks, type HistoryPoint } from "./storage-history-data";

/** Neutral like the destination bars on the dashboard. Color is kept for states, not for sizes. */
const chartConfig = {
    size: { label: "Size", color: "color-mix(in oklab, var(--foreground) 80%, transparent)" },
} satisfies ChartConfig;

interface StorageHistoryChartProps {
    points: HistoryPoint[];
    /** One point per day, so the tooltip names the day without a time. */
    daily: boolean;
    dayKey: (at: number) => string;
}

/** Size over time on a time axis, so a gap without measurements keeps its real width. */
export function StorageHistoryChart({ points, daily, dayKey }: StorageHistoryChartProps) {
    const { formatDate } = useDateFormatter();
    const y = byteTicks(Math.max(...points.map((point) => point.size)));
    const days = dayTicks(points, dayKey);
    // Within a single day the axis labels the hours instead of repeating the date.
    const withinDay = days.length < 2;

    return (
        <ChartContainer config={chartConfig} className="aspect-auto size-full">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                <defs>
                    <linearGradient id="storage-history-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-size)" stopOpacity={0.16} />
                        <stop offset="100%" stopColor="var(--color-size)" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                    dataKey="at"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    ticks={withinDay ? points.map((point) => point.at) : days}
                    tickFormatter={(at: number) => formatDate(new Date(at), withinDay ? "p" : "MMM d")}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    interval="preserveStartEnd"
                    fontSize={11}
                    className="tabular-nums"
                />
                <YAxis
                    domain={[0, y.top]}
                    ticks={y.ticks}
                    tickFormatter={y.format}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    fontSize={11}
                    className="tabular-nums"
                />
                <ChartTooltip
                    cursor={{ stroke: "var(--border)" }}
                    content={({ active, payload }) => {
                        const point = payload?.[0]?.payload as HistoryPoint | undefined;
                        if (!active || !point) return null;
                        return (
                            <div className="grid min-w-32 gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                                <span className="text-muted-foreground">{formatDate(new Date(point.at), daily ? "P" : "Pp")}</span>
                                <span className="font-medium tabular-nums">{formatBytes(point.size)}</span>
                                <span className="text-muted-foreground tabular-nums">
                                    {point.count.toLocaleString()} backup{point.count === 1 ? "" : "s"}
                                </span>
                            </div>
                        );
                    }}
                />
                <Area
                    dataKey="size"
                    type="linear"
                    stroke="var(--color-size)"
                    strokeWidth={1.5}
                    fill="url(#storage-history-fill)"
                    isAnimationActive={false}
                />
            </AreaChart>
        </ChartContainer>
    );
}
