"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, Bell, ChevronsUpDown, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getNotificationTemplates } from "@/app/actions/templates";
import { NotificationTemplateDialog } from "@/components/settings/templates/notification-template-list";
import { Badge } from "@/components/ui/badge";
import { AdapterConfig } from "@prisma/client";

type NotificationTemplate = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isSystem: boolean;
  channels: {
    id: string;
    configId: string;
    events: string;
    config: AdapterConfig;
  }[];
  _count: { jobs: number };
};

interface Props {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  usedIds?: string[];
}

export function NotificationTemplatePicker({
  value,
  onChange,
  placeholder = "Add notification template...",
  usedIds = [],
}: Props) {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NotificationTemplate | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [availableChannels, setAvailableChannels] = useState<AdapterConfig[]>([]);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const res = await getNotificationTemplates();
    if (res.success && res.data) {
      setTemplates(res.data as NotificationTemplate[]);
    } else {
      toast.error("Failed to load notification templates");
    }
    setLoading(false);
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/adapters?type=notification");
      if (res.ok) {
        const data = await res.json();
        setAvailableChannels(data);
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates();
    fetchChannels();
  }, [fetchTemplates, fetchChannels]);

  const selected = templates.find((t) => t.id === value);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={loading}
            className="w-full justify-between font-normal"
          >
            {loading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading...
              </span>
            ) : selected ? (
              <span className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                {selected.name}
                <Badge variant="secondary" className="text-xs">
                  {selected.channels.length} channel{selected.channels.length !== 1 ? "s" : ""}
                </Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search templates..." />
            <CommandList>
              <CommandEmpty>No templates found.</CommandEmpty>
              <CommandGroup>
                {templates.map((t) => {
                  const isUsed = usedIds.includes(t.id) && t.id !== value;
                  return (
                    <CommandItem
                      key={t.id}
                      value={t.name}
                      disabled={isUsed}
                      className="group pr-1"
                      onSelect={() => {
                        onChange(t.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === t.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="flex-1 flex items-center gap-2">
                        {t.name}
                        {t.isDefault && (
                          <Badge variant="secondary" className="text-xs">Default</Badge>
                        )}
                      </span>
                      {!t.isSystem && (
                        <button
                          type="button"
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 rounded p-0.5 hover:bg-accent"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            setEditTarget(t);
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="__create__"
                  onSelect={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                  className="font-medium"
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Create new template...
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <NotificationTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        availableChannels={availableChannels}
        onSuccess={(t) => {
          setTemplates((prev) =>
            [...prev.filter((x) => x.id !== t.id), t as NotificationTemplate].sort(
              (a, b) => a.name.localeCompare(b.name)
            )
          );
          onChange(t.id);
          setCreateOpen(false);
        }}
      />

      <NotificationTemplateDialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditTarget(null);
        }}
        template={editTarget as any}
        availableChannels={availableChannels}
        onSuccess={(t) => {
          setTemplates((prev) =>
            prev.map((x) => (x.id === t.id ? (t as NotificationTemplate) : x))
          );
          setEditTarget(null);
          setEditOpen(false);
        }}
      />
    </>
  );
}
