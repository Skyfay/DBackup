"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StorageVolumeEntry } from "@/services/dashboard-service";
import { formatBytes } from "@/lib/utils";
import { HardDrive } from "lucide-react";

interface StorageVolumeChartProps {
  data: StorageVolumeEntry[];
}

export function StorageVolumeChart({ data }: StorageVolumeChartProps) {
  if (data.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Storage Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No storage destinations configured.
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalSize = data.reduce((sum, entry) => sum + entry.size, 0);
  const totalCount = data.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Storage Usage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
                  <HardDrive className="h-4 w-4 text-foreground" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{entry.name}</span>
                  <span className="text-xs text-muted-foreground">{entry.count} backups</span>
                </div>
              </div>
              <div className="text-sm font-bold font-mono">
                {formatBytes(entry.size)}
              </div>
            </div>
          ))}
          {data.length > 1 && (
            <>
              <div className="border-t" />
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Total</span>
                  <span className="text-xs text-muted-foreground">{totalCount} backups</span>
                </div>
                <div className="text-sm font-bold font-mono">
                  {formatBytes(totalSize)}
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
