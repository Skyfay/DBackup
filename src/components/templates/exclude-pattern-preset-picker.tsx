"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((v) => setB.has(v));
}

interface Props {
  /** The directory source row's current exclude pattern list (ground truth, always freely editable via the Textarea below this picker). */
  patterns: string[];
  onPatternsChange: (patterns: string[]) => void;
  /** Which saved preset (if any) this row's patterns were last seeded from - provenance only, cleared automatically on hand-edit. */
  presetId: string | null | undefined;
  onPresetIdChange: (id: string | null) => void;
}

/**
 * Lets a directory source row load a saved, reusable set of exclude patterns on top of its
 * own free-text list. Selecting a preset merges (appends + dedupes) its patterns into the
 * row rather than overwriting - the row may already contain tree-computed structural excludes.
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

  // Clear the "seeded from" link once hand-edits make the row's patterns diverge from the
  // preset it was loaded from - keeps the picker from implying it's still in sync when it isn't.
  const lastCheckedPatterns = useRef<string[]>(patterns);
  useEffect(() => {
    if (presetId && selected && !sameSet(patterns, parsePatterns(selected.patterns)) && lastCheckedPatterns.current !== patterns) {
      onPresetIdChange(null);
    }
    lastCheckedPatterns.current = patterns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patterns, presetId, selected]);

  const applyPreset = (preset: ExcludePatternPreset) => {
    const presetPatterns = parsePatterns(preset.patterns);
    const merged = [...patterns];
    for (const p of presetPatterns) {
      if (!merged.includes(p)) merged.push(p);
    }
    onPatternsChange(merged);
    onPresetIdChange(preset.id);
  };

  return (
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
                {patterns.length > 0 ? "(modified)" : "Load preset..."}
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
                      applyPreset(preset);
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
        title="Save current patterns as a preset"
        disabled={patterns.length === 0}
        onClick={() => setCreateOpen(true)}
      >
        <Save className="h-3.5 w-3.5" />
      </Button>

      <ExcludePatternPresetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialPatterns={patterns}
        onSuccess={(preset) => {
          setPresets((prev) => [...prev.filter((p) => p.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)));
          onPresetIdChange(preset.id);
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
