"use client";

import { useCallback, useEffect, useState } from "react";
import { Filter } from "lucide-react";
import type { ExcludePatternPreset } from "@prisma/client";
import { toast } from "sonner";
import { getExcludePatternPresets } from "@/app/actions/templates";
import { useCan } from "@/components/permissions/permissions-context";
import { ExcludePatternPresetDialog } from "@/components/settings/templates/exclude-pattern-preset-dialog";
import { Badge } from "@/components/ui/badge";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { resolveExcludePatterns } from "@/lib/exclude-groups";

function parsePatterns(patterns: string): string[] {
  try {
    const parsed = JSON.parse(patterns);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** What a preset leaves out: its groups plus its own entries, the same resolution the backup applies. */
function patternsOf(preset: ExcludePatternPreset): string[] {
  return resolveExcludePatterns({
    groups: parsePatterns(preset.groups),
    excludedGroupPatterns: parsePatterns(preset.excludedGroupPatterns),
    patterns: parsePatterns(preset.patterns),
  });
}

function entryOf(preset: ExcludePatternPreset): PickEntry {
  const patterns = patternsOf(preset);
  const first = patterns.slice(0, 2).join(", ");
  return {
    id: preset.id,
    name: preset.name,
    meta: patterns.length === 0 ? "Leaves out nothing yet" : patterns.length > 2 ? `${first} and ${patterns.length - 2} more` : first,
    keywords: [...patterns, ...(preset.description ? [preset.description] : [])],
    // A preset that ships with DBackup changes with its releases, nobody edits it.
    editable: !preset.isSystem,
  };
}

const byName = (a: ExcludePatternPreset, b: ExcludePatternPreset) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Preset ids already linked by sibling rows, left out here so a folder never links one twice. */
  usedIds?: string[];
}

/**
 * Picks one exclude preset for a row of a folder source, like every field that picks a saved
 * entry: the presets in a list that says what each leaves out, Edit on a row and New at its foot,
 * both only for a viewer who may write templates. A folder links several presets as rows (see
 * job-folder-row.tsx), and picking one only links it, its patterns stay in the preset and show
 * below as they are now.
 */
export function ExcludePatternPresetPicker({ value, onChange, placeholder = "Pick a preset", usedIds = [] }: Props) {
  const [presets, setPresets] = useState<ExcludePatternPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; preset?: ExcludePatternPreset }>({ open: false });
  const canWrite = useCan(PERMISSIONS.TEMPLATES.WRITE);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    const res = await getExcludePatternPresets();
    if (res.success && res.data) setPresets(res.data);
    else toast.error("The exclude presets could not be loaded.");
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchPresets();
  }, [fetchPresets]);

  const selected = presets.find((preset) => preset.id === value);
  const selectedPatterns = selected ? patternsOf(selected) : [];
  const offered = presets.filter((preset) => preset.id === value || !usedIds.includes(preset.id));

  const openDialog = (preset?: ExcludePatternPreset) => {
    setOpen(false);
    setDialog({ open: true, preset });
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <PickTrigger icon={Filter} loading={loading} disabled={loading} aria-expanded={open} size="sm" className="h-8 w-full flex-none">
            {loading ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : selected ? (
              <span className="truncate">{selected.name}</span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </PickTrigger>
        </PopoverTrigger>
        <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden p-0">
          <PickList
            icon={Filter}
            title="Pick from Templates"
            note="Exclude presets"
            groups={[{ entries: offered.map(entryOf) }]}
            value={value}
            emptyText={presets.length === 0 ? "There is no exclude preset yet." : "Nothing matches."}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
            onEdit={canWrite ? (id) => openDialog(presets.find((preset) => preset.id === id)) : undefined}
            createLabel="New preset"
            onCreate={canWrite ? () => openDialog() : undefined}
          />
        </PopoverContent>
      </Popover>

      {selected && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="shrink-0 text-muted-foreground">Leaves out:</span>
          {selectedPatterns.length === 0 ? (
            <span className="text-muted-foreground">nothing yet</span>
          ) : (
            selectedPatterns.map((pattern, index) => (
              <Badge key={index} variant="outline" className="font-mono text-xs">{pattern}</Badge>
            ))
          )}
        </div>
      )}

      <ExcludePatternPresetDialog
        open={dialog.open}
        onOpenChange={(next) => setDialog((current) => ({ ...current, open: next }))}
        preset={dialog.preset}
        onSuccess={(preset) => {
          setPresets((list) => [...list.filter((entry) => entry.id !== preset.id), preset].sort(byName));
          // A new preset is linked right away, an edited one only refreshes what the row shows.
          if (!dialog.preset) onChange(preset.id);
          // The preset stays until the dialog has faded out, so its head does not turn into New on the way.
          setDialog((current) => ({ ...current, open: false }));
        }}
      />
    </div>
  );
}
