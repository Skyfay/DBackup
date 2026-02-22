"use client";

import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/utils";
import { HardDrive, FileStack, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { StorageSnapshotEntry } from "@/services/dashboard-service";
import { useDateFormatter } from "@/hooks/use-date-formatter";

const sizeChartConfig = {
  size: {
    label: "Storage Size",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const countChartConfig = {
  count: {
    label: "Backup Count",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

interface StorageHistoryTabProps {
  configId: string;
  adapterName: string;
}

export interface StorageHistoryTabRef {
  refresh: () => void;
}

export const StorageHistoryTab = forwardRef<StorageHistoryTabRef, StorageHistoryTabProps>(
  function StorageHistoryTab({ configId, adapterName }, ref) {
  const [data, setData] = useState<StorageSnapshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const { formatDate } = useDateFormatter();

  const fetchHistory = useCallback(async () => {
    if (!configId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/storage/${configId}/history?days=${days}`);
      const json = await res.json();

      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || "Failed to load history");
      }
    } catch {
      setError("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [configId, days]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useImperativeHandle(ref, () => ({
    refresh: fetchHistory,
  }), [fetchHistory]);

  const formatXAxis = (dateStr: string) => {
    return formatDate(dateStr, "P");
  };

  const formatTooltipDate = (dateStr: string) => {
    return formatDate(dateStr, "Pp");
  };

  // Computed stats
  const currentSize = data.length > 0 ? data[data.length - 1].size : 0;
  const currentCount = data.length > 0 ? data[data.length - 1].count : 0;
  const oldestSize = data.length > 0 ? data[0].size : 0;
  const oldestCount = data.length > 0 ? data[0].count : 0;
  const sizeDiff = currentSize - oldestSize;
  const countDiff = currentCount - oldestCount;

  // Average size per snapshot
  const avgSize = data.length > 0 ? data.reduce((sum, d) => sum + d.size, 0) / data.length : 0;

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-6 w-56 mb-2" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>

        {/* Stats cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-28 mb-2" />
                <Skeleton className="h-3 w-36" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(2)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32 mb-1" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-72 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{adapterName} — Storage History</h3>
          <p className="text-sm text-muted-foreground">
            Storage usage and backup count over time.
          </p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="14">14 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
            <SelectItem value="180">180 days</SelectItem>
            <SelectItem value="365">1 year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Current Size</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{formatBytes(currentSize)}</div>
            <div className="flex items-center gap-1 mt-1">
              {sizeDiff > 0 ? (
                <TrendingUp className="h-3 w-3 text-orange-500" />
              ) : sizeDiff < 0 ? (
                <TrendingDown className="h-3 w-3 text-green-500" />
              ) : (
                <Minus className="h-3 w-3 text-muted-foreground" />
              )}
              <span className={`text-xs font-mono ${sizeDiff > 0 ? "text-orange-500" : sizeDiff < 0 ? "text-green-500" : "text-muted-foreground"}`}>
                {sizeDiff > 0 ? "+" : ""}{formatBytes(Math.abs(sizeDiff))} vs {days}d ago
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Backup Count</CardTitle>
            <FileStack className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{currentCount}</div>
            <div className="flex items-center gap-1 mt-1">
              {countDiff > 0 ? (
                <TrendingUp className="h-3 w-3 text-blue-500" />
              ) : countDiff < 0 ? (
                <TrendingDown className="h-3 w-3 text-orange-500" />
              ) : (
                <Minus className="h-3 w-3 text-muted-foreground" />
              )}
              <span className={`text-xs font-mono ${countDiff !== 0 ? "text-muted-foreground" : "text-muted-foreground"}`}>
                {countDiff > 0 ? "+" : ""}{countDiff} vs {days}d ago
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Average Size</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{formatBytes(avgSize)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Over {data.length} snapshot{data.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {data.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              No historical data available yet. Data is collected with each storage stats refresh.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Storage Size Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Storage Size</CardTitle>
              <CardDescription>Total storage usage over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ChartContainer config={sizeChartConfig} className="h-full w-full">
                  <AreaChart
                    data={data}
                    accessibilityLayer
                    margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="fillSize" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-size)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-size)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      tickMargin={10}
                      axisLine={false}
                      fontSize={12}
                      tickFormatter={formatXAxis}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      width={70}
                      tickFormatter={(value: number) => formatBytes(value)}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={formatTooltipDate}
                          formatter={(value) => formatBytes(value as number)}
                        />
                      }
                    />
                    <Area
                      dataKey="size"
                      type="monotone"
                      fill="url(#fillSize)"
                      stroke="var(--color-size)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            </CardContent>
          </Card>

          {/* Backup Count Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Backup Count</CardTitle>
              <CardDescription>Number of backup files over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ChartContainer config={countChartConfig} className="h-full w-full">
                  <BarChart
                    data={data}
                    accessibilityLayer
                    margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      tickMargin={10}
                      axisLine={false}
                      fontSize={12}
                      tickFormatter={formatXAxis}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      width={40}
                      allowDecimals={false}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={formatTooltipDate}
                          formatter={(value) => `${value} backups`}
                        />
                      }
                    />
                    <Bar
                      dataKey="count"
                      fill="var(--color-count)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
});
