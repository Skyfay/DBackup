"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActivityDataPoint } from "@/services/dashboard-service";

const chartConfig = {
  completed: {
    label: "Completed",
    color: "hsl(145, 78%, 45%)",
  },
  failed: {
    label: "Failed",
    color: "hsl(357, 78%, 54%)",
  },
  running: {
    label: "Running",
    color: "hsl(45, 93%, 58%)",
  },
  pending: {
    label: "Pending",
    color: "hsl(225, 79%, 54%)",
  },
} satisfies ChartConfig;

interface ActivityChartProps {
  data: ActivityDataPoint[];
}

export function ActivityChart({ data }: ActivityChartProps) {
  const hasData = data.some(
    (d) => d.completed > 0 || d.failed > 0 || d.running > 0 || d.pending > 0
  );

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle>Jobs Activity</CardTitle>
        <CardDescription>Last 14 days</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ChartContainer config={chartConfig} className="h-[250px] w-full">
            <BarChart data={data} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                fontSize={12}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                fontSize={12}
                width={30}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="completed"
                stackId="a"
                fill="var(--color-completed)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="failed"
                stackId="a"
                fill="var(--color-failed)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="running"
                stackId="a"
                fill="var(--color-running)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="pending"
                stackId="a"
                fill="var(--color-pending)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            No execution data yet. Run your first backup to see activity here.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
