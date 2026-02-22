"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, TrendingUp, Shield, Clock } from "lucide-react";

interface StorageSettingsTabProps {
  adapterName: string;
}

export function StorageSettingsTab({ adapterName }: StorageSettingsTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{adapterName} — Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure alerts and monitoring for this storage destination.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Storage Alerts */}
        <Card className="relative overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Storage Alerts</CardTitle>
              </div>
              <Badge variant="secondary" className="text-[10px]">Coming Soon</Badge>
            </div>
            <CardDescription>
              Get notified when storage usage changes unexpectedly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 opacity-50 pointer-events-none">
            <div className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-4 w-4 text-orange-500" />
                <div>
                  <p className="text-sm font-medium">Usage Spike Alert</p>
                  <p className="text-xs text-muted-foreground">Alert when storage grows more than a threshold</p>
                </div>
              </div>
              <div className="h-5 w-9 rounded-full bg-muted" />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
              <div className="flex items-center gap-3">
                <Shield className="h-4 w-4 text-red-500" />
                <div>
                  <p className="text-sm font-medium">Storage Limit Warning</p>
                  <p className="text-xs text-muted-foreground">Alert when approaching a configured size limit</p>
                </div>
              </div>
              <div className="h-5 w-9 rounded-full bg-muted" />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-sm font-medium">Missing Backup Alert</p>
                  <p className="text-xs text-muted-foreground">Alert when no backup is created within a time window</p>
                </div>
              </div>
              <div className="h-5 w-9 rounded-full bg-muted" />
            </div>
          </CardContent>
        </Card>

        {/* Anomaly Detection */}
        <Card className="relative overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Anomaly Detection</CardTitle>
              </div>
              <Badge variant="secondary" className="text-[10px]">Coming Soon</Badge>
            </div>
            <CardDescription>
              Automatically detect unusual storage patterns.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 opacity-50 pointer-events-none">
            <div className="p-3 border rounded-md bg-muted/20 space-y-2">
              <p className="text-sm font-medium">Sudden Size Increase</p>
              <p className="text-xs text-muted-foreground">
                Detect when a single backup is significantly larger than the average — may indicate unintended data changes or misconfigurations.
              </p>
              <div className="h-8 w-full rounded bg-muted" />
            </div>
            <div className="p-3 border rounded-md bg-muted/20 space-y-2">
              <p className="text-sm font-medium">Sudden Size Decrease</p>
              <p className="text-xs text-muted-foreground">
                Detect when storage drops unexpectedly — may indicate accidental deletions or retention policy issues.
              </p>
              <div className="h-8 w-full rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
