"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Star,
  Bell,
  Settings2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { AdapterConfig } from "@prisma/client";
import {
  getNotificationTemplates,
  createNotificationTemplate,
  updateNotificationTemplate,
  deleteNotificationTemplate,
  setDefaultNotificationTemplate,
  unsetDefaultNotificationTemplate,
} from "@/app/actions/templates";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { bulkDeleteNotificationTemplates } from "@/app/actions/templates-bulk";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import { AdapterIcon } from "@/components/adapter/adapter-icon";

type NotificationTemplateWithChannels = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  channels: {
    id: string;
    configId: string;
    events: string;
    config: AdapterConfig;
  }[];
  _count: { jobs: number };
};

const EVENT_OPTIONS = [
  { value: "SUCCESS", label: "Success" },
  { value: "PARTIAL", label: "Partial" },
  { value: "FAILED", label: "Failed" },
] as const;

interface ChannelRow {
  configId: string;
  events: string[];
}

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template?: NotificationTemplateWithChannels;
  availableChannels: AdapterConfig[];
  onSuccess: (t: NotificationTemplateWithChannels) => void;
}

export function NotificationTemplateDialog({
  open,
  onOpenChange,
  template,
  availableChannels,
  onSuccess,
}: TemplateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [expandedChannels, setExpandedChannels] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setChannels(
        template?.channels.map((ch) => ({
          configId: ch.configId,
          events: ch.events.split("|").filter(Boolean),
        })) ?? []
      );
      setExpandedChannels(new Set());
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, template]);

  const toggleExpanded = (index: number) => {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addChannel = () => {
    const unused = availableChannels.find(
      (c) => !channels.some((ch) => ch.configId === c.id)
    );
    if (unused) {
      setChannels((prev) => [
        ...prev,
        { configId: unused.id, events: ["SUCCESS", "PARTIAL", "FAILED"] },
      ]);
    } else if (availableChannels.length > 0) {
      setChannels((prev) => [
        ...prev,
        { configId: availableChannels[0].id, events: ["SUCCESS", "PARTIAL", "FAILED"] },
      ]);
    }
  };

  const removeChannel = (index: number) => {
    setChannels((prev) => prev.filter((_, i) => i !== index));
    setExpandedChannels((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
  };

  const updateChannelConfig = (index: number, configId: string) => {
    setChannels((prev) =>
      prev.map((ch, i) => (i === index ? { ...ch, configId } : ch))
    );
  };

  const toggleEvent = (index: number, event: string) => {
    setChannels((prev) =>
      prev.map((ch, i) => {
        if (i !== index) return ch;
        const has = ch.events.includes(event);
        return {
          ...ch,
          events: has
            ? ch.events.filter((e) => e !== event)
            : [...ch.events, event],
        };
      })
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (channels.length === 0) {
      toast.error("At least one channel is required");
      return;
    }
    for (const ch of channels) {
      if (ch.events.length === 0) {
        toast.error("Each channel needs at least one event selected");
        return;
      }
    }

    setSaving(true);
    const channelInput = channels.map((ch) => ({
      configId: ch.configId,
      events: ch.events.join("|"),
    }));

    const res = template
      ? await updateNotificationTemplate(template.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          channels: channelInput,
        })
      : await createNotificationTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          channels: channelInput,
        });

    setSaving(false);

    if (res.success && res.data) {
      toast.success(template ? "Template updated" : "Template created");
      onSuccess(res.data as unknown as NotificationTemplateWithChannels);
    } else {
      toast.error(res.error || "Failed to save template");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent tone={template ? "edit" : "create"} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit Notification Template" : "Create Notification Template"}
          </DialogTitle>
          <DialogDescription>
            Configure which channels receive notifications and for which backup outcomes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My notification template"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Channels</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addChannel}
                disabled={availableChannels.length === 0}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Channel
              </Button>
            </div>

            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No channels configured. Add at least one.
              </p>
            ) : (
              <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-80">
                <div className="space-y-2 pr-3">
                  {channels.map((ch, i) => {
                    const config = availableChannels.find((c) => c.id === ch.configId);
                    const isExpanded = expandedChannels.has(i);
                    return (
                      <div key={i} className="border rounded-lg">
                        <div className="flex items-center gap-2 p-3">
                          <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">
                            #{i + 1}
                          </span>

                          <div className="flex-1 min-w-0">
                            <Select
                              value={ch.configId}
                              onValueChange={(v) => updateChannelConfig(i, v)}
                            >
                              <SelectTrigger className="h-9 w-full">
                                <SelectValue>
                                  {config && (
                                    <span className="flex items-center gap-2 min-w-0">
                                      <AdapterIcon
                                        adapterId={config.adapterId}
                                        className="h-4 w-4 shrink-0"
                                      />
                                      <span className="truncate">{config.name}</span>
                                    </span>
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {availableChannels.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    <span className="flex items-center gap-2">
                                      <AdapterIcon
                                        adapterId={c.adapterId}
                                        className="h-4 w-4"
                                      />
                                      {c.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 px-2"
                            onClick={() => toggleExpanded(i)}
                            title="Event settings"
                          >
                            <Settings2 className="h-4 w-4 mr-1" />
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 px-2 text-muted-foreground hover:text-destructive"
                            onClick={() => removeChannel(i)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <Collapsible open={isExpanded}>
                          <CollapsibleContent>
                            <div className="border-t px-3 py-3 bg-muted/30 space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">
                                Notify on
                              </div>
                              <div className="flex gap-4">
                                {EVENT_OPTIONS.map((opt) => (
                                  <label
                                    key={opt.value}
                                    className="flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={ch.events.includes(opt.value)}
                                      onCheckedChange={() => toggleEvent(i, opt.value)}
                                    />
                                    <span className="text-xs">{opt.label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {template ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface NotificationTemplateListProps {
  availableChannels: AdapterConfig[];
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

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const res = await getNotificationTemplates();
    if (res.success && res.data) {
      setTemplates(res.data as NotificationTemplateWithChannels[]);
    } else {
      toast.error("Failed to load notification templates");
    }
    setLoading(false);
  }, []);

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

      <NotificationTemplateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        availableChannels={availableChannels}
        onSuccess={(t) => {
          setTemplates((prev) =>
            [...prev.filter((x) => x.id !== t.id), t].sort((a, b) =>
              a.name.localeCompare(b.name)
            )
          );
          setIsCreateOpen(false);
        }}
      />

      <NotificationTemplateDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        template={editTarget ?? undefined}
        availableChannels={availableChannels}
        onSuccess={(t) => {
          setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
          setEditTarget(null);
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
