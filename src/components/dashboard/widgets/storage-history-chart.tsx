"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { formatBytes } from "@/lib/utils";
import { byteTicks, dayTicks, type HistoryPoint } from "./storage-history-data";

/** Neutral like the destination bars on the dashboard. The newest measurement carries the accent. */
const chartConfig = {
    size: { label: "Size", color: "color-mix(in oklab, var(--foreground) 55%, transparent)" },
} satisfies ChartConfig;

/** Above this many bars the gaps and the rounded corners disappear, or they eat the bar. */
const DENSE = 60;

interface StorageHistoryChartProps {
    points: HistoryPoint[];
    /** One point per day, so the tooltip names the day without a time. */
    daily: boolean;
    dayKey: (at: number) => string;
}

/** Size over time, one bar per measured day and the newest one in the accent colour. */
export function StorageHistoryChart({ points, daily, dayKey }: StorageHistoryChartProps) {
    const { formatDate } = useDateFormatter();
    const y = byteTicks(Math.max(...points.map((point) => point.size ?? 0)));
    const days = dayTicks(points, dayKey);
    // Within a single day the axis labels the hours instead of repeating the date.
    const withinDay = days.length < 2;
    const dense = points.length > DENSE;
    const newest = points[points.length - 1]?.at;

    return (
        <ChartContainer config={chartConfig} className="aspect-auto size-full">
            <BarChart
                data={points}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                barCategoryGap={dense ? "4%" : "18%"}
                maxBarSize={36}
                accessibilityLayer
            >
                <CartesianGrid vertical={false} />
                <XAxis
                    dataKey="at"
                    type="category"
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
                    cursor={{ fill: "var(--foreground)", fillOpacity: 0.06 }}
                    content={({ active, payload }) => {
                        const point = payload?.[0]?.payload as HistoryPoint | undefined;
                        if (!active || !point) return null;
                        return (
                            <div className="grid min-w-32 gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                                <span className="text-muted-foreground">{formatDate(new Date(point.at), daily ? "P" : "Pp")}</span>
                                {point.size === null ? (
                                    <span className="text-muted-foreground">Not measured</span>
                                ) : (
                                    <>
                                        <span className="font-medium tabular-nums">{formatBytes(point.size)}</span>
                                        <span className="text-muted-foreground tabular-nums">
                                            {point.count.toLocaleString()} backup{point.count === 1 ? "" : "s"}
                                        </span>
                                    </>
                                )}
                            </div>
                        );
                    }}
                />
                <Bar dataKey="size" radius={dense ? 1 : 3} isAnimationActive={false}>
                    {points.map((point) => (
                        <Cell key={point.at} fill={point.at === newest ? "var(--info)" : "var(--color-size)"} />
                    ))}
                </Bar>
            </BarChart>
        </ChartContainer>
    );
}
