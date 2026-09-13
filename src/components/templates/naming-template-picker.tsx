"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, FileText, ChevronsUpDown, Check, Star, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { NamingTemplate } from "@prisma/client";
import { getNamingTemplates } from "@/app/actions/templates";
import { NamingTemplateDialog } from "@/components/settings/templates/naming-template-list";

interface Props {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
}

export function NamingTemplatePicker({ value, onChange, placeholder, allowNone }: Props) {
  const [templates, setTemplates] = useState<NamingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NamingTemplate | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const res = await getNamingTemplates();
    if (res.success && res.data) {
      setTemplates(res.data);
      // If no value is set yet and allowNone is false, auto-select the default template
      if (!value && !allowNone) {
        const defaultTemplate = res.data.find((t) => t.isDefault);
        if (defaultTemplate) {
          onChange(defaultTemplate.id);
        }
      }
    } else {
      toast.error("Failed to load naming templates");
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const selected = templates.find((t) => t.id === value);
  const defaultTemplate = templates.find((t) => t.isDefault);
  const displayPlaceholder =
    placeholder ??
    (defaultTemplate ? `Standard (${defaultTemplate.name})` : "Select template...");

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={loading}
            className="w-full min-w-0 justify-between font-normal"
          >
            {loading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading...
              </span>
            ) : selected ? (
              <span className="flex items-center gap-2 min-w-0">
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{selected.name}</span>
                {selected.isDefault && (
                  <Badge variant="outline" className="text-xs ml-1 shrink-0 border-yellow-500 text-yellow-600">
                    Default
                  </Badge>
                )}
              </span>
            ) : defaultTemplate ? (
              <span className="flex items-center gap-2 min-w-0">
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate text-muted-foreground">{defaultTemplate.name}</span>
                <Badge variant="outline" className="text-xs ml-1 shrink-0 border-yellow-500/50 text-yellow-600/70">
                  Default
                </Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">{displayPlaceholder}</span>
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
                {templates.map((template) => (
                  <CommandItem
                    key={template.id}
                    value={template.name}
                    className="group pr-1"
                    onSelect={() => {
                      onChange(template.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === template.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex flex-1 items-center gap-2">
                      {template.name}
                      {template.isDefault && (
                        <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                      )}
                    </span>
                    {!template.isSystem && (
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 rounded p-0.5 hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(false);
                          setEditTarget(template);
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              {value && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => {
                        onChange(null);
                        setOpen(false);
                      }}
                    >
                      <Check className="mr-2 h-4 w-4 opacity-0" />
                      <span className="text-muted-foreground">Use default template</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
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

      <NamingTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(template) => {
          setTemplates((prev) =>
            [...prev.filter((t) => t.id !== template.id), template].sort(
              (a, b) => a.name.localeCompare(b.name)
            )
          );
          onChange(template.id);
          setCreateOpen(false);
        }}
      />

      <NamingTemplateDialog
        open={editOpen}
        onOpenChange={(v) => { setEditOpen(v); if (!v) setEditTarget(null); }}
        template={editTarget ?? undefined}
        onSuccess={(template) => {
          setTemplates((prev) => prev.map((t) => t.id === template.id ? template : t));
          setEditTarget(null);
          setEditOpen(false);
        }}
      />
    </>
  );
}
