"use client";

import { useEffect, useState, useCallback } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { StorageSnapshotEntry } from "@/services/dashboard-service";
import { useDateFormatter } from "@/hooks/use-date-formatter";

const chartConfig = {
  size: {
    label: "Storage Size",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

interface StorageHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: string;
  adapterName: string;
}

export function StorageHistoryModal({
  open,
  onOpenChange,
  configId,
  adapterName,
}: StorageHistoryModalProps) {
  const [data, setData] = useState<StorageSnapshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const { formatDate } = useDateFormatter();

  const fetchHistory = useCallback(async () => {
    if (!configId || !open) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/storage/${configId}/history?days=${days}`
      );
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
  }, [configId, days, open]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const formatXAxis = (dateStr: string) => {
    return formatDate(dateStr, "P");
  };

  const formatTooltipDate = (dateStr: string) => {
    return formatDate(dateStr, "Pp");
  };

  const currentSize = data.length > 0 ? data[data.length - 1].size : 0;
  const currentCount = data.length > 0 ? data[data.length - 1].count : 0;
  const oldestSize = data.length > 0 ? data[0].size : 0;
  const sizeDiff = currentSize - oldestSize;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{adapterName} – Storage History</DialogTitle>
          <DialogDescription>
            Storage usage over time for this destination.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-2xl font-bold font-mono">
                {formatBytes(currentSize)}
              </span>
              <span className="text-xs text-muted-foreground">
                {currentCount} backups
              </span>
            </div>
            {data.length > 1 && (
              <div className="flex flex-col">
                <span
                  className={`text-sm font-mono ${
                    sizeDiff > 0
                      ? "text-orange-500"
                      : sizeDiff < 0
                        ? "text-green-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {sizeDiff > 0 ? "+" : ""}
                  {formatBytes(Math.abs(sizeDiff))}
                </span>
                <span className="text-xs text-muted-foreground">
                  vs {days}d ago
                </span>
              </div>
            )}
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

        <div className="h-72">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          ) : data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No historical data available yet. Data is collected with each storage stats refresh.
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="h-full w-full">
              <AreaChart
                data={data}
                accessibilityLayer
                margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="fillSize" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-size)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-size)"
                      stopOpacity={0.05}
                    />
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
