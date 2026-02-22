"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { DateDisplay } from "@/components/utils/date-display";

export interface NotificationLogRow {
  id: string;
  eventType: string;
  channelId?: string;
  channelName: string;
  adapterId: string;
  status: "Success" | "Failed";
  title: string;
  message: string;
  fields?: string; // JSON string
  color?: string;
  renderedHtml?: string;
  renderedPayload?: string;
  error?: string;
  executionId?: string;
  sentAt: string;
}

/** Maps adapter IDs to human-readable labels */
const ADAPTER_LABELS: Record<string, string> = {
  email: "Email",
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  teams: "Teams",
  ntfy: "ntfy",
  gotify: "Gotify",
  "generic-webhook": "Webhook",
  "twilio-sms": "SMS",
};

/** Maps event type strings to display labels */
const EVENT_LABELS: Record<string, string> = {
  backup_success: "Backup Success",
  backup_failure: "Backup Failed",
  restore_complete: "Restore Complete",
  restore_failure: "Restore Failed",
  user_login: "User Login",
  user_created: "User Created",
  config_backup: "Config Backup",
  system_error: "System Error",
  storage_usage_spike: "Storage Spike",
  storage_limit_warning: "Storage Limit",
  storage_missing_backup: "Missing Backup",
};

export const createNotificationLogColumns = (
  onViewDetail: (row: NotificationLogRow) => void
): ColumnDef<NotificationLogRow>[] => [
  {
    id: "title",
    accessorKey: "title",
    header: "Notification",
    cell: ({ row }) => {
      const entry = row.original;
      return (
        <div className="flex flex-col">
          <span className="font-medium truncate max-w-80" title={entry.title}>
            {entry.title}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {entry.channelName}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "adapterId",
    header: "Adapter",
    cell: ({ row }) => {
      const adapterId = row.getValue("adapterId") as string;
      return (
        <Badge variant="outline">
          {ADAPTER_LABELS[adapterId] || adapterId}
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "eventType",
    header: "Event",
    cell: ({ row }) => {
      const eventType = row.getValue("eventType") as string;
      return (
        <span className="text-sm text-muted-foreground">
          {EVENT_LABELS[eventType] || eventType}
        </span>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      if (status === "Success") {
        return (
          <Badge className="bg-[hsl(145,78%,45%)] text-white border-transparent hover:bg-[hsl(145,78%,40%)]">
            Sent
          </Badge>
        );
      }
      return (
        <Badge className="bg-[hsl(357,78%,54%)] text-white border-transparent hover:bg-[hsl(357,78%,48%)]">
          Failed
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "sentAt",
    header: "Sent At",
    cell: ({ row }) => {
      return <DateDisplay date={row.getValue("sentAt")} format="PPpp" />;
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      return (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewDetail(row.original)}
        >
          <Eye className="mr-2 h-4 w-4" />
          Preview
        </Button>
      );
    },
  },
];
