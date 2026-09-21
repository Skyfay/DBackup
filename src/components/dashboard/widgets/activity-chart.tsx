"use client";

import { Bar, BarChart, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { ActivityDataPoint } from "@/services/dashboard-service";

type SeriesKey = "completed" | "cancelled" | "partial" | "failed" | "pending" | "running";

/** Bottom to top, so failures and live runs sit on top of each day's bar. */
const SERIES: { key: SeriesKey; label: string; color: string }[] = [
    { key: "completed", label: "Completed", color: "var(--success)" },
    { key: "cancelled", label: "Cancelled", color: "var(--muted-foreground)" },
    { key: "partial", label: "Partial", color: "var(--warning)" },
    { key: "failed", label: "Failed", color: "var(--destructive)" },
    { key: "pending", label: "Queued", color: "color-mix(in oklab, var(--info) 45%, transparent)" },
    { key: "running", label: "Running", color: "var(--info)" },
];

const chartConfig = Object.fromEntries(
    SERIES.map((series) => [series.key, { label: series.label, color: series.color }])
) satisfies ChartConfig;

/** The series that occur in the data, for the legend. */
export function activeSeries(data: ActivityDataPoint[]) {
    return SERIES.filter((series) => data.some((day) => day[series.key] > 0));
}

export function ActivityLegend({ data }: { data: ActivityDataPoint[] }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {activeSeries(data).map((series) => (
                <span key={series.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-[2px]" style={{ background: series.color }} aria-hidden="true" />
                    {series.label}
                </span>
            ))}
        </div>
    );
}

/** Runs per day as stacked bars, with gaps between the segments. */
export function ActivityChart({ data }: { data: ActivityDataPoint[] }) {
    if (activeSeries(data).length === 0) {
        return (
            <div className="flex h-44 items-center justify-center text-sm text-muted-foreground md:h-52">
                No runs in the last {data.length} days.
            </div>
        );
    }

    return (
        <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full md:h-52">
            <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="16%" accessibilityLayer>
                <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={28}
                    interval="preserveStartEnd"
                    fontSize={11}
                    className="font-mono"
                />
                <ChartTooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                    content={({ active, label, payload }) => (
                        <ChartTooltipContent
                            active={active}
                            label={label}
                            payload={payload?.filter((item) => Number(item.value) > 0)}
                        />
                    )}
                />
                {SERIES.map((series) => (
                    <Bar
                        key={series.key}
                        dataKey={series.key}
                        stackId="runs"
                        fill={`var(--color-${series.key})`}
                        radius={3}
                        stroke="var(--card)"
                        strokeWidth={2}
                    />
                ))}
            </BarChart>
        </ChartContainer>
    );
}
