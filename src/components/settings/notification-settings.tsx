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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, ChevronsUpDown, Mail, Send, Shield, Database, RotateCcw, Monitor } from "lucide-react";
import {
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotification,
} from "@/app/actions/notification-settings";
import type { SystemNotificationConfig, NotifyUserMode } from "@/lib/notifications/types";
import type { NotificationEventDefinition } from "@/lib/notifications/types";

interface Channel {
  id: string;
  name: string;
  adapterId: string;
}

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  auth: {
    label: "Authentication",
    icon: <Shield className="h-4 w-4" />,
    description: "User login and account events.",
  },
  backup: {
    label: "Backup",
    icon: <Database className="h-4 w-4" />,
    description: "Backup job success and failure events.",
  },
  restore: {
    label: "Restore",
    icon: <RotateCcw className="h-4 w-4" />,
    description: "Database restore events.",
  },
  system: {
    label: "System",
    icon: <Monitor className="h-4 w-4" />,
    description: "System-level events and errors.",
  },
};

export function NotificationSettings() {
  const [config, setConfig] = useState<SystemNotificationConfig | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [eventDefs, setEventDefs] = useState<NotificationEventDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingTest, setSendingTest] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    (async () => {
      const result = await getNotificationSettings();
      if (result.success && result.data) {
        setConfig(result.data.config);
        setChannels(result.data.availableChannels);
        setEventDefs(result.data.eventDefinitions);
      } else {
        toast.error("Failed to load notification settings");
      }
      setLoading(false);
    })();
  }, []);

  // Persist config changes
  const persistConfig = useCallback(
    async (updated: SystemNotificationConfig) => {
      setConfig(updated);
      toast.promise(updateNotificationSettings(updated), {
        loading: "Saving...",
        success: (res) => {
          if (res.success) return "Notification settings saved";
          throw new Error(res.error);
        },
        error: (err) => `Failed to save: ${err.message || "Unknown error"}`,
      });
    },
    []
  );

  // ── Channel selection helpers ────────────────────────────────

  const toggleGlobalChannel = useCallback(
    (channelId: string) => {
      if (!config) return;
      const current = config.globalChannels;
      const updated = current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [...current, channelId];
      persistConfig({ ...config, globalChannels: updated });
    },
    [config, persistConfig]
  );

  // ── Event toggle helpers ─────────────────────────────────────

  const toggleEvent = useCallback(
    (eventId: string, enabled: boolean) => {
      if (!config) return;
      const eventConfig = config.events[eventId] || {
        enabled: false,
        channels: null,
      };
      persistConfig({
        ...config,
        events: {
          ...config.events,
          [eventId]: { ...eventConfig, enabled },
        },
      });
    },
    [config, persistConfig]
  );

  const toggleEventChannel = useCallback(
    (eventId: string, channelId: string) => {
      if (!config) return;
      const eventConfig = config.events[eventId] || {
        enabled: true,
        channels: null,
      };
      // Initialize from global channels if no override yet
      const currentChannels =
        eventConfig.channels ?? [...config.globalChannels];
      const updated = currentChannels.includes(channelId)
        ? currentChannels.filter((id) => id !== channelId)
        : [...currentChannels, channelId];
      persistConfig({
        ...config,
        events: {
          ...config.events,
          [eventId]: { ...eventConfig, channels: updated.length > 0 ? updated : null },
        },
      });
    },
    [config, persistConfig]
  );

  const resetEventChannels = useCallback(
    (eventId: string) => {
      if (!config) return;
      const eventConfig = config.events[eventId];
      if (!eventConfig) return;
      persistConfig({
        ...config,
        events: {
          ...config.events,
          [eventId]: { ...eventConfig, channels: null },
        },
      });
    },
    [config, persistConfig]
  );

  // ── Notify-user mode toggle (auth events) ───────────────────

  const changeNotifyUser = useCallback(
    (eventId: string, mode: NotifyUserMode) => {
      if (!config) return;
      const eventConfig = config.events[eventId] || {
        enabled: true,
        channels: null,
      };
      persistConfig({
        ...config,
        events: {
          ...config.events,
          [eventId]: { ...eventConfig, notifyUser: mode },
        },
      });
    },
    [config, persistConfig]
  );

  // ── Test notification ────────────────────────────────────────

  const handleTestNotification = useCallback(
    async (eventType: string) => {
      setSendingTest(eventType);
      toast.promise(sendTestNotification(eventType), {
        loading: "Sending test notification...",
        success: (res) => {
          if (res.success) return res.message || "Test notification sent";
          throw new Error(res.error);
        },
        error: (err) =>
          `Failed to send test: ${err.message || "Unknown error"}`,
        finally: () => setSendingTest(null),
      });
    },
    []
  );

  // ── Rendering ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!config) {
    return null;
  }

  // Group events by category
  const grouped: Record<string, NotificationEventDefinition[]> = {};
  for (const def of eventDefs) {
    if (!grouped[def.category]) grouped[def.category] = [];
    grouped[def.category].push(def);
  }

  const selectedChannelNames = config.globalChannels
    .map((id) => channels.find((c) => c.id === id)?.name)
    .filter(Boolean);

  return (
    <div className="space-y-6">
      {/* ── Global Channel Selector ─────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Notification Channels</CardTitle>
          </div>
          <CardDescription>
            Select which notification channels receive system notifications by default.
            You can configure existing channels in the Notifications section.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notification channels configured yet. Create a Notification adapter
              (e.g. Email, Discord) first.
            </p>
          ) : (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                  >
                    {selectedChannelNames.length > 0
                      ? `${selectedChannelNames.length} channel${selectedChannelNames.length > 1 ? "s" : ""} selected`
                      : "Select channels..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search channels..." />
                    <CommandList>
                      <CommandEmpty>No channels found.</CommandEmpty>
                      <CommandGroup>
                        {channels.map((ch) => (
                          <CommandItem
                            key={ch.id}
                            value={ch.name}
                            onSelect={() => toggleGlobalChannel(ch.id)}
                          >
                            <Checkbox
                              checked={config.globalChannels.includes(ch.id)}
                              className="mr-2"
                            />
                            <span>{ch.name}</span>
                            <Badge variant="secondary" className="ml-auto text-xs">
                              {ch.adapterId}
                            </Badge>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {selectedChannelNames.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {config.globalChannels.map((id) => {
                    const ch = channels.find((c) => c.id === id);
                    if (!ch) return null;
                    return (
                      <Badge key={id} variant="secondary">
                        {ch.name}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Event Configuration ─────────────────────────────── */}
      {Object.entries(grouped).map(([category, events]) => {
        const meta = CATEGORY_META[category] || {
          label: category,
          icon: <Bell className="h-4 w-4" />,
          description: "",
        };

        return (
          <Card key={category}>
            <CardHeader>
              <div className="flex items-center gap-2">
                {meta.icon}
                <CardTitle>{meta.label} Events</CardTitle>
              </div>
              <CardDescription>{meta.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {events.map((eventDef, idx) => {
                const eventConfig = config.events[eventDef.id];
                const isEnabled = eventConfig
                  ? eventConfig.enabled
                  : eventDef.defaultEnabled;
                const hasOverride = eventConfig?.channels !== null && eventConfig?.channels !== undefined;
                const effectiveChannels = hasOverride
                  ? eventConfig!.channels!
                  : config.globalChannels;

                return (
                  <div key={eventDef.id}>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-1 flex-1 mr-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {eventDef.name}
                          </span>
                          {hasOverride && (
                            <Badge variant="outline" className="text-xs">
                              Custom Channels
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {eventDef.description}
                        </p>

                        {/* Per-event channel override */}
                        {isEnabled && channels.length > 0 && (
                          <div className="flex items-center gap-2 pt-2 flex-wrap">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                >
                                  <Bell className="mr-1 h-3 w-3" />
                                  {effectiveChannels.length} channel
                                  {effectiveChannels.length !== 1 ? "s" : ""}
                                  <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-64 p-0"
                                align="start"
                              >
                                <Command>
                                  <CommandInput placeholder="Search..." />
                                  <CommandList>
                                    <CommandEmpty>
                                      No channels found.
                                    </CommandEmpty>
                                    <CommandGroup>
                                      {channels.map((ch) => (
                                        <CommandItem
                                          key={ch.id}
                                          value={ch.name}
                                          onSelect={() =>
                                            toggleEventChannel(
                                              eventDef.id,
                                              ch.id
                                            )
                                          }
                                        >
                                          <Checkbox
                                            checked={effectiveChannels.includes(
                                              ch.id
                                            )}
                                            className="mr-2"
                                          />
                                          <span className="text-xs">
                                            {ch.name}
                                          </span>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                                {hasOverride && (
                                  <div className="border-t p-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="w-full text-xs"
                                      onClick={() =>
                                        resetEventChannels(eventDef.id)
                                      }
                                    >
                                      Reset to Global Channels
                                    </Button>
                                  </div>
                                )}
                              </PopoverContent>
                            </Popover>

                            {/* Test button */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={
                                sendingTest === eventDef.id ||
                                effectiveChannels.length === 0
                              }
                              onClick={() =>
                                handleTestNotification(eventDef.id)
                              }
                            >
                              <Send className="mr-1 h-3 w-3" />
                              Test
                            </Button>
                          </div>
                        )}

                        {/* Notify user option for auth events */}
                        {isEnabled &&
                          eventDef.supportsNotifyUser &&
                          channels.some(
                            (ch) =>
                              ch.adapterId === "email" &&
                              effectiveChannels.includes(ch.id)
                          ) && (
                          <div className="flex items-center gap-2 pt-1">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              Notify user directly:
                            </span>
                            <Select
                              value={
                                (eventConfig?.notifyUser as string) ?? "none"
                              }
                              onValueChange={(val) =>
                                changeNotifyUser(
                                  eventDef.id,
                                  val as NotifyUserMode
                                )
                              }
                            >
                              <SelectTrigger className="h-7 w-35 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Disabled</SelectItem>
                                <SelectItem value="also">
                                  Admin &amp; User
                                </SelectItem>
                                <SelectItem value="only">User only</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>

                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(val) =>
                          toggleEvent(eventDef.id, val)
                        }
                      />
                    </div>
                    {idx < events.length - 1 && (
                      <Separator className="my-1 opacity-0" />
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
