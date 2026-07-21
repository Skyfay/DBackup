"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, Filter, ChevronsUpDown, Check, Pencil, Save } from "lucide-react";
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
import { ExcludePatternPreset } from "@prisma/client";
import { getExcludePatternPresets } from "@/app/actions/templates";
import { ExcludePatternPresetDialog } from "@/components/settings/templates/exclude-pattern-preset-list";

function parsePatterns(patterns: string): string[] {
  try {
    const parsed = JSON.parse(patterns);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

interface Props {
  /** This row's own job-specific extra patterns - independent of the linked preset's patterns. */
  patterns: string[];
  onPatternsChange: (patterns: string[]) => void;
  /** Live-linked preset id, if any - editing the preset elsewhere retroactively applies here. */
  presetId: string | null | undefined;
  onPresetIdChange: (id: string | null) => void;
}

/**
 * Live-linked template picker (matches NamingTemplatePicker/SchedulePreset semantics): selecting
 * a preset only sets the reference - it never copies patterns into the row's own list. The
 * preset's current patterns are shown read-only below and re-fetch on every mount, so editing the
 * preset in Settings -> Templates and coming back here reflects the update. Job-specific patterns
 * stay a fully independent, always-editable field.
 */
export function ExcludePatternPresetPicker({ patterns, onPatternsChange, presetId, onPresetIdChange }: Props) {
  const [presets, setPresets] = useState<ExcludePatternPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExcludePatternPreset | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    const res = await getExcludePatternPresets();
    if (res.success && res.data) {
      setPresets(res.data);
    } else {
      toast.error("Failed to load exclude pattern presets");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const selected = presets.find((p) => p.id === presetId);
  const selectedPatterns = selected ? parsePatterns(selected.patterns) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              size="sm"
              aria-expanded={open}
              disabled={loading}
              className="h-8 justify-between font-normal flex-1 min-w-0"
            >
              {loading ? (
                <span className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading...
                </span>
              ) : selected ? (
                <span className="flex items-center gap-1.5 min-w-0 text-xs">
                  <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate">{selected.name}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground">
                  <Filter className="h-3 w-3 shrink-0" />
                  No template linked
                </span>
              )}
              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search presets..." />
              <CommandList>
                <CommandEmpty>No presets found.</CommandEmpty>
                <CommandGroup>
                  {presets.map((preset) => (
                    <CommandItem
                      key={preset.id}
                      value={preset.name}
                      className="group pr-1"
                      onSelect={() => {
                        onPresetIdChange(preset.id);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", presetId === preset.id ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1">{preset.name}</span>
                      {!preset.isSystem && (
                        <button
                          type="button"
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 rounded p-0.5 hover:bg-accent"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            setEditTarget(preset);
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {presetId && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        value="__clear__"
                        onSelect={() => {
                          onPresetIdChange(null);
                          setOpen(false);
                        }}
                      >
                        <Check className="mr-2 h-4 w-4 opacity-0" />
                        <span className="text-muted-foreground">No template</span>
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
                    Create new preset...
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 shrink-0"
          title="Save this job's extra patterns as a new preset"
          disabled={patterns.length === 0}
          onClick={() => setCreateOpen(true)}
        >
          <Save className="h-3.5 w-3.5" />
        </Button>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground shrink-0">From template (live):</span>
          {selectedPatterns.length === 0 ? (
            <span className="text-muted-foreground italic">no patterns</span>
          ) : (
            selectedPatterns.map((p, i) => (
              <Badge key={i} variant="outline" className="font-mono text-xs">{p}</Badge>
            ))
          )}
        </div>
      )}

      <ExcludePatternPresetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialPatterns={patterns}
        onSuccess={(preset) => {
          setPresets((prev) => [...prev.filter((p) => p.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)));
          onPresetIdChange(preset.id);
          onPatternsChange([]);
          setCreateOpen(false);
        }}
      />

      <ExcludePatternPresetDialog
        open={editOpen}
        onOpenChange={(v) => { setEditOpen(v); if (!v) setEditTarget(null); }}
        preset={editTarget ?? undefined}
        onSuccess={(preset) => {
          setPresets((prev) => prev.map((p) => (p.id === preset.id ? preset : p)));
          setEditTarget(null);
          setEditOpen(false);
        }}
      />
    </div>
  );
}
