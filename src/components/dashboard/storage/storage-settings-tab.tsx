"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Bell,
  TrendingUp,
  Shield,
  Clock,
  Save,
  Info,
} from "lucide-react";
import {
  getStorageAlertSettings,
  updateStorageAlertSettings,
} from "@/app/actions/storage-alerts";

interface StorageAlertConfig {
  usageSpikeEnabled: boolean;
  usageSpikeThresholdPercent: number;
  storageLimitEnabled: boolean;
  storageLimitBytes: number;
  missingBackupEnabled: boolean;
  missingBackupHours: number;
}

interface StorageSettingsTabProps {
  configId: string;
  adapterName: string;
}

/** Convert bytes to a human-readable size unit and value */
function bytesToUnit(bytes: number): { value: number; unit: string } {
  if (bytes >= 1024 * 1024 * 1024 * 1024) {
    return { value: Math.round(bytes / (1024 * 1024 * 1024 * 1024)), unit: "TB" };
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return { value: Math.round(bytes / (1024 * 1024 * 1024)), unit: "GB" };
  }
  if (bytes >= 1024 * 1024) {
    return { value: Math.round(bytes / (1024 * 1024)), unit: "MB" };
  }
  return { value: Math.round(bytes / 1024), unit: "KB" };
}

/** Convert value + unit back to bytes */
function unitToBytes(value: number, unit: string): number {
  switch (unit) {
    case "KB":
      return value * 1024;
    case "MB":
      return value * 1024 * 1024;
    case "GB":
      return value * 1024 * 1024 * 1024;
    case "TB":
      return value * 1024 * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

export function StorageSettingsTab({
  configId,
  adapterName,
}: StorageSettingsTabProps) {
  const [config, setConfig] = useState<StorageAlertConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Storage limit - separate value and unit for ergonomic editing
  const [limitValue, setLimitValue] = useState(10);
  const [limitUnit, setLimitUnit] = useState("GB");

  // Load settings when configId changes
  const fetchSettings = useCallback(async () => {
    if (!configId) return;

    setLoading(true);
    setDirty(false);

    try {
      const result = await getStorageAlertSettings(configId);
      if (result.success && result.data) {
        setConfig(result.data);
        const { value, unit } = bytesToUnit(result.data.storageLimitBytes);
        setLimitValue(value);
        setLimitUnit(unit);
      } else {
        toast.error("Failed to load alert settings");
      }
    } finally {
      setLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateField = useCallback(
    <K extends keyof StorageAlertConfig>(
      key: K,
      value: StorageAlertConfig[K]
    ) => {
      setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
      setDirty(true);
    },
    []
  );

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    const toSave = {
      ...config,
      storageLimitBytes: unitToBytes(limitValue, limitUnit),
    };

    const result = await updateStorageAlertSettings(configId, toSave);
    if (result.success) {
      toast.success("Alert settings saved");
      setDirty(false);
    } else {
      toast.error(result.error || "Failed to save settings");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{adapterName} — Alerts</h3>
          <p className="text-sm text-muted-foreground">
            Configure monitoring alerts for this storage destination. Notifications are sent through the channels configured in Settings &gt; Notifications.
          </p>
        </div>
        <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Usage Spike Alert */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-orange-500" />
                <CardTitle className="text-base">Usage Spike Alert</CardTitle>
              </div>
              <Switch
                checked={config.usageSpikeEnabled}
                onCheckedChange={(v) => updateField("usageSpikeEnabled", v)}
              />
            </div>
            <CardDescription>
              Alert when storage size changes significantly between refresh cycles.
            </CardDescription>
          </CardHeader>
          <CardContent
            className={
              config.usageSpikeEnabled ? "" : "opacity-50 pointer-events-none"
            }
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="spike-threshold">Change Threshold (%)</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="spike-threshold"
                    type="number"
                    min={1}
                    max={1000}
                    value={config.usageSpikeThresholdPercent}
                    onChange={(e) =>
                      updateField(
                        "usageSpikeThresholdPercent",
                        parseInt(e.target.value) || 50
                      )
                    }
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Triggers when total storage size increases or decreases by more than the threshold percentage compared to the previous snapshot.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Storage Limit Warning */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-red-500" />
                <CardTitle className="text-base">
                  Storage Limit Warning
                </CardTitle>
              </div>
              <Switch
                checked={config.storageLimitEnabled}
                onCheckedChange={(v) => updateField("storageLimitEnabled", v)}
              />
            </div>
            <CardDescription>
              Alert when storage usage approaches a configured size limit.
            </CardDescription>
          </CardHeader>
          <CardContent
            className={
              config.storageLimitEnabled
                ? ""
                : "opacity-50 pointer-events-none"
            }
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="limit-size">Size Limit</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="limit-size"
                    type="number"
                    min={1}
                    value={limitValue}
                    onChange={(e) => {
                      setLimitValue(parseInt(e.target.value) || 1);
                      setDirty(true);
                    }}
                    className="w-24"
                  />
                  <Select
                    value={limitUnit}
                    onValueChange={(v) => {
                      setLimitUnit(v);
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                      <SelectItem value="TB">TB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  A warning is sent when usage reaches 90% of the configured limit.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Missing Backup Alert */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-base">
                  Missing Backup Alert
                </CardTitle>
              </div>
              <Switch
                checked={config.missingBackupEnabled}
                onCheckedChange={(v) =>
                  updateField("missingBackupEnabled", v)
                }
              />
            </div>
            <CardDescription>
              Alert when no new backups appear within a configured time window.
            </CardDescription>
          </CardHeader>
          <CardContent
            className={
              config.missingBackupEnabled
                ? ""
                : "opacity-50 pointer-events-none"
            }
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="missing-hours">Time Window (hours)</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="missing-hours"
                    type="number"
                    min={1}
                    max={8760}
                    value={config.missingBackupHours}
                    onChange={(e) =>
                      updateField(
                        "missingBackupHours",
                        parseInt(e.target.value) || 48
                      )
                    }
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Checks if the backup file count has remained unchanged for longer than this threshold. Requires at least 2 storage snapshots.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notification Info */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">
                Notification Delivery
              </CardTitle>
            </div>
            <CardDescription>
              How storage alert notifications are delivered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p>
                    Storage alerts are sent through the notification channels configured in <strong>Settings &gt; Notifications</strong>.
                  </p>
                  <p>
                    You can enable or disable individual storage event types and configure which channels receive them in the notification settings.
                  </p>
                  <p className="text-xs">
                    Events: <em>Storage Usage Spike</em>, <em>Storage Limit Warning</em>, <em>Missing Backup Alert</em>
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
