"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Star,
  Bell,
} from "lucide-react";
import type { TemplateChannelConnection } from "@/services/templates/notification-template-service";
import type { NotificationTemplateItem } from "@/components/templates/notification-model";
import {
  getNotificationTemplates,
  deleteNotificationTemplate,
  setDefaultNotificationTemplate,
  unsetDefaultNotificationTemplate,
} from "@/app/actions/templates";
import { NotificationTemplateDialog } from "./notification-template-dialog";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { bulkDeleteNotificationTemplates } from "@/app/actions/templates-bulk";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import { AdapterIcon } from "@/components/adapter/adapter-icon";

/** A template as the list shows it, with when it last changed and how many jobs use it. */
type NotificationTemplateWithChannels = NotificationTemplateItem & {
  createdAt: Date;
  updatedAt: Date;
  _count: { jobs: number };
};

interface NotificationTemplateListProps {
  availableChannels: TemplateChannelConnection[];
}

export function NotificationTemplateList({
  availableChannels,
}: NotificationTemplateListProps) {
  const [templates, setTemplates] = useState<NotificationTemplateWithChannels[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NotificationTemplateWithChannels | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NotificationTemplateWithChannels | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState<string | null>(null);

  // Loads the templates without the spinner, like after a save, where the table stays in place.
  const refresh = useCallback(async () => {
    const res = await getNotificationTemplates();
    if (res.success && res.data) {
      setTemplates(res.data as NotificationTemplateWithChannels[]);
    } else {
      toast.error("Failed to load notification templates");
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    await refresh();
    setLoading(false);
  }, [refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates();
  }, [fetchTemplates]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const res = await deleteNotificationTemplate(deleteTarget.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Template deleted");
      setDeleteTarget(null);
      fetchTemplates();
    } else {
      toast.error(res.error || "Failed to delete template");
    }
  };

  const handleToggleDefault = async (t: NotificationTemplateWithChannels) => {
    setIsSettingDefault(t.id);
    const res = t.isDefault
      ? await unsetDefaultNotificationTemplate()
      : await setDefaultNotificationTemplate(t.id);
    setIsSettingDefault(null);
    if (res.success) {
      fetchTemplates();
    } else {
      toast.error(res.error || "Failed to update default");
    }
  };

  const bulkActions = useMemo<BulkAction<NotificationTemplateWithChannels>[]>(() => [
    {
      id: "delete",
      labels: { verb: "delete", verbPast: "deleted", noun: "notification template" },
      icon: Trash2,
      variant: "destructive",
      itemName: (row) => row.name,
      // Built-in entries ship with the product and the service refuses them anyway.
      ineligible: (row) => (row.isSystem ? "Built-in, cannot be deleted" : null),
      confirm: {
        title: (rows) => `Delete ${rows.length} notification template${rows.length === 1 ? "" : "s"}?`,
        description: () =>
          "A template still used by a job is kept and listed afterwards.",
        confirmLabel: "Delete",
      },
      run: (rows) => unwrapBulkAction(bulkDeleteNotificationTemplates(rows.map((row) => row.id))),
    },
  ], []);

  const columns: ColumnDef<NotificationTemplateWithChannels>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium">{row.original.name}</span>
          {row.original.isDefault && (
            <Badge variant="secondary" className="text-xs">Default</Badge>
          )}
          {row.original.isSystem && (
            <Badge variant="outline" className="text-xs">System</Badge>
          )}
        </div>
      ),
    },
    {
      id: "channels",
      header: "Channels",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.channels.map((ch) => (
            <Badge key={ch.id} variant="secondary" className="gap-1 text-xs">
              <AdapterIcon adapterId={ch.config.adapterId} className="h-3 w-3" />
              {ch.config.name}
            </Badge>
          ))}
          {row.original.channels.length === 0 && (
            <span className="text-xs text-muted-foreground italic">No channels</span>
          )}
        </div>
      ),
    },
    {
      id: "jobs",
      header: "Jobs",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original._count?.jobs ?? 0}
        </span>
      ),
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: ({ row }) => <DateDisplay date={row.original.updatedAt} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="flex items-center gap-1 justify-end">
            <Button
              variant="ghost"
              size="icon"
              title={t.isDefault ? "Unset as default" : "Set as default"}
              disabled={isSettingDefault === t.id}
              onClick={() => handleToggleDefault(t)}
            >
              {isSettingDefault === t.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Star
                  className={`h-4 w-4 ${t.isDefault ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                />
              )}
            </Button>
            {!t.isSystem && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditTarget(t)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(t)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Notification Templates</CardTitle>
              <CardDescription>
                Reusable notification configurations with per-channel event filters.
              </CardDescription>
            </div>
            <Button tone="create" size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Create Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={templates}
              enableRowSelection
              getRowId={(row) => row.id}
              bulkActions={bulkActions}
              onBulkActionComplete={fetchTemplates}
            />
          )}
        </CardContent>
      </Card>

      {/* The list loads again after a save, so the saved template comes with its jobs and its date. */}
      <NotificationTemplateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        channels={availableChannels}
        onSuccess={() => {
          setIsCreateOpen(false);
          void refresh();
        }}
      />

      <NotificationTemplateDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        template={editTarget ?? undefined}
        channels={availableChannels}
        onSuccess={() => {
          setEditTarget(null);
          void refresh();
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent tone="destructive">
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
