"use client";

import { Label, Pie, PieChart } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobStatusDistribution } from "@/services/dashboard-service";
import { useMemo } from "react";

const chartConfig = {
  count: {
    label: "Executions",
  },
  Success: {
    label: "Completed",
    color: "hsl(145, 78%, 45%)",
  },
  Failed: {
    label: "Failed",
    color: "hsl(357, 78%, 54%)",
  },
  Running: {
    label: "Running",
    color: "hsl(225, 79%, 54%)",
  },
  Pending: {
    label: "Pending",
    color: "hsl(45, 93%, 58%)",
  },
} satisfies ChartConfig;

interface JobStatusChartProps {
  data: JobStatusDistribution[];
}

export function JobStatusChart({ data }: JobStatusChartProps) {
  const total = useMemo(
    () => data.reduce((acc, curr) => acc + curr.count, 0),
    [data]
  );

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        fill: `var(--color-${d.status})`,
      })),
    [data]
  );

  if (total === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Job Status</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-50 items-center justify-center text-sm text-muted-foreground">
            No execution data available.
          </div>
        </CardContent>
      </Card>
    );
  }

  const successCount = data.find((d) => d.status === "Success")?.count ?? 0;
  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Job Status</CardTitle>
        <CardDescription>Last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-48">
          <PieChart accessibilityLayer>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="status"
              innerRadius={55}
              outerRadius={80}
              strokeWidth={2}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-2xl font-bold"
                        >
                          {successRate}%
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 20}
                          className="fill-muted-foreground text-xs"
                        >
                          Success
                        </tspan>
                      </text>
                    );
                  }
                }}
              />
            </Pie>
            <ChartLegend
              content={<ChartLegendContent nameKey="status" />}
              className="-translate-y-2 flex-wrap gap-2 *:basis-1/4 *:justify-center"
            />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
