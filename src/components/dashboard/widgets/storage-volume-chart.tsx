"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StorageVolumeEntry } from "@/services/dashboard-service";
import { formatBytes } from "@/lib/utils";

interface StorageVolumeChartProps {
  data: StorageVolumeEntry[];
}

export function StorageVolumeChart({ data }: StorageVolumeChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Storage by Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-50 items-center justify-center text-sm text-muted-foreground">
            No storage destinations configured.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Color palette for multiple storage destinations
  const colors = [
    "hsl(145, 78%, 45%)",
    "hsl(225, 79%, 54%)",
    "hsl(45, 93%, 58%)",
    "hsl(280, 65%, 60%)",
    "hsl(357, 78%, 54%)",
  ];

  const chartData = data.map((entry, index) => ({
    name: entry.name,
    size: entry.size,
    count: entry.count,
    fill: colors[index % colors.length],
  }));

  const dynamicConfig: ChartConfig = {
    size: { label: "Size" },
    ...Object.fromEntries(
      chartData.map((entry) => [
        entry.name,
        { label: entry.name, color: entry.fill },
      ])
    ),
  };

  const chartHeight = Math.max(120, data.length * 50);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage by Volume</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={dynamicConfig} className="w-full" style={{ height: chartHeight }}>
          <BarChart data={chartData} layout="vertical" accessibilityLayer margin={{ left: 0, right: 16 }}>
            <YAxis
              dataKey="name"
              type="category"
              tickLine={false}
              axisLine={false}
              width={100}
              fontSize={12}
            />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatBytes(value)}
              fontSize={12}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => formatBytes(Number(value))}
                />
              }
            />
            <Bar dataKey="size" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
