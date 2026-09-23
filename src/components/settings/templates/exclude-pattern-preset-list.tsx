"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Filter, Star } from "lucide-react";
import { ExcludePatternPreset } from "@prisma/client";
import {
  getExcludePatternPresets,
  createExcludePatternPreset,
  updateExcludePatternPreset,
  deleteExcludePatternPreset,
} from "@/app/actions/templates";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { bulkDeleteExcludePatternPresets } from "@/app/actions/templates-bulk";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import { Checkbox } from "@/components/ui/checkbox";
import { EXCLUDE_GROUPS, resolveExcludePatterns } from "@/lib/exclude-groups";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

function parsePatterns(patterns: string): string[] {
  try {
    const parsed = JSON.parse(patterns);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function ExcludePatternPresetList() {
  const [presets, setPresets] = useState<ExcludePatternPreset[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExcludePatternPreset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExcludePatternPreset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPresets();
  }, [fetchPresets]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const res = await deleteExcludePatternPreset(deleteTarget.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Exclude pattern preset deleted");
      setDeleteTarget(null);
      fetchPresets();
    } else {
      toast.error(res.error || "Failed to delete preset");
    }
  };

  const handleToggleDefault = async (preset: ExcludePatternPreset) => {
    setIsSettingDefault(preset.id);
    const res = await updateExcludePatternPreset(preset.id, { isDefault: !preset.isDefault });
    if (res.success) {
      toast.success(
        preset.isDefault
          ? `"${preset.name}" is no longer pre-selected on new sources`
          : `"${preset.name}" will be pre-selected on new directory sources`
      );
      fetchPresets();
    } else {
      toast.error(res.error || "Failed to update preset");
    }
    setIsSettingDefault(null);
  };

  const bulkActions = useMemo<BulkAction<ExcludePatternPreset>[]>(() => [
    {
      id: "delete",
      labels: { verb: "delete", verbPast: "deleted", noun: "exclude preset" },
      icon: Trash2,
      variant: "destructive",
      itemName: (row) => row.name,
      // Built-in entries ship with the product and the service refuses them anyway.
      ineligible: (row) => (row.isSystem ? "Built-in, cannot be deleted" : null),
      confirm: {
        title: (rows) => `Delete ${rows.length} exclude preset${rows.length === 1 ? "" : "s"}?`,
        description: () =>
          "An entry that is still in use is kept and listed afterwards.",
        confirmLabel: "Delete",
      },
      run: (rows) => unwrapBulkAction(bulkDeleteExcludePatternPresets(rows.map((row) => row.id))),
    },
  ], []);

  const columns: ColumnDef<ExcludePatternPreset>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name}</span>
          {row.original.isDefault && (
            <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600">
              Default
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "patterns",
      header: "Patterns",
      cell: ({ row }) => {
        // What this preset actually applies: the groups it follows, minus opt-outs, plus its
        // own entries - the same resolution the backup and restore paths perform.
        const patterns = resolveExcludePatterns({
          groups: parsePatterns(row.original.groups),
          excludedGroupPatterns: parsePatterns(row.original.excludedGroupPatterns),
          patterns: parsePatterns(row.original.patterns),
        });
        return (
          <div className="flex flex-wrap gap-1 max-w-md">
            {patterns.length === 0 && <span className="text-xs text-muted-foreground">No patterns</span>}
            {patterns.slice(0, 5).map((p, i) => (
              <Badge key={i} variant="outline" className="font-mono text-xs">{p}</Badge>
            ))}
            {patterns.length > 5 && (
              <Badge variant="outline" className="text-xs">+{patterns.length - 5} more</Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <DateDisplay date={row.original.createdAt} />,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="icon"
            title={row.original.isDefault ? "Stop pre-selecting on new sources" : "Pre-select on new directory sources"}
            onClick={() => handleToggleDefault(row.original)}
            disabled={isSettingDefault === row.original.id}
          >
            {isSettingDefault === row.original.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className={`h-4 w-4 ${row.original.isDefault ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`} />
            )}
          </Button>
          {/* A built-in preset stays editable - its patterns are a starting point, not a rule -
              but it cannot be deleted, so unstarring is how you opt out of it. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditTarget(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={row.original.isSystem ? "Built-in presets cannot be deleted" : undefined}
            onClick={() => setDeleteTarget(row.original)}
            disabled={row.original.isSystem}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Exclude Pattern Presets
            </CardTitle>
            <CardDescription>
              Reusable sets of glob patterns (e.g. node_modules/**, *.tmp) to exclude from directory-source backups.
            </CardDescription>
          </div>
          <Button tone="create" onClick={() => setIsCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Preset
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={presets}
            isLoading={loading}
            enableRowSelection
            getRowId={(row) => row.id}
            bulkActions={bulkActions}
            onBulkActionComplete={fetchPresets}
          />
        </CardContent>
      </Card>

      <ExcludePatternPresetDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
          setIsCreateOpen(false);
          fetchPresets();
        }}
      />

      {editTarget && (
        <ExcludePatternPresetDialog
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          preset={editTarget}
          onSuccess={() => {
            setEditTarget(null);
            fetchPresets();
          }}
        />
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent tone="destructive">
          <DialogHeader>
            <DialogTitle>Delete Exclude Pattern Preset</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone. Directory
              sources previously seeded from this preset keep their own saved patterns unchanged.
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
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ExcludePatternPresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: ExcludePatternPreset;
  /** Pre-fills the Patterns field, e.g. when promoting an ad-hoc list from the job form into a saved preset. */
  initialPatterns?: string[];
  onSuccess: (preset: ExcludePatternPreset) => void;
}

export function ExcludePatternPresetDialog({
  open,
  onOpenChange,
  preset,
  initialPatterns,
  onSuccess,
}: ExcludePatternPresetDialogProps) {
  const [name, setName] = useState(preset?.name ?? "");
  const [description, setDescription] = useState(preset?.description ?? "");
  const [patternsText, setPatternsText] = useState(
    preset ? parsePatterns(preset.patterns).join("\n") : (initialPatterns ?? []).join("\n")
  );
  // Curated groups this preset follows, and the individual patterns it opts out of. Stored as
  // references so a group extended in a later release reaches this preset on its own.
  const [groups, setGroups] = useState<string[]>(preset ? parsePatterns(preset.groups) : []);
  const [optedOut, setOptedOut] = useState<string[]>(preset ? parsePatterns(preset.excludedGroupPatterns) : []);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(preset?.name ?? "");
      setDescription(preset?.description ?? "");
      setPatternsText(preset ? parsePatterns(preset.patterns).join("\n") : (initialPatterns ?? []).join("\n"));
      setGroups(preset ? parsePatterns(preset.groups) : []);
      setOptedOut(preset ? parsePatterns(preset.excludedGroupPatterns) : []);
    }
  }, [open, preset, initialPatterns]);

  const handleSave = async () => {
    if (!name.trim()) return;
    const patterns = patternsText.split("\n").map((l) => l.trim()).filter(Boolean);
    setIsSaving(true);
    const res = preset
      ? await updateExcludePatternPreset(preset.id, { name, description, patterns, groups, excludedGroupPatterns: optedOut })
      : await createExcludePatternPreset({ name, description, patterns, groups, excludedGroupPatterns: optedOut });
    setIsSaving(false);
    if (res.success && res.data) {
      toast.success(preset ? "Exclude pattern preset updated" : "Exclude pattern preset created");
      onSuccess(res.data);
    } else {
      toast.error(res.error || "Failed to save exclude pattern preset");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent tone={preset ? "edit" : "create"} className="max-w-2xl h-[85vh]">
        <DialogHeader>
          <DialogTitle>
            {preset ? "Edit Exclude Pattern Preset" : "New Exclude Pattern Preset"}
          </DialogTitle>
          <DialogDescription>
            Define a reusable set of glob patterns to exclude from directory-source backups.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 pr-4 -mr-4">
          <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="epp-name">Name</Label>
            <Input
              id="epp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Node.js defaults"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="epp-desc">Description (optional)</Label>
            <Textarea
              id="epp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              rows={2}
            />
          </div>
          {/* Curated lists, referenced rather than copied: DBackup keeps them current across
              releases, and unticking a single pattern below opts out of just that one. */}
          <div className="space-y-2">
            <Label>Built-in groups</Label>
            <p className="text-xs text-muted-foreground">
              Maintained by DBackup and kept up to date with each release. Untick individual patterns to skip them.
            </p>
            <div className="space-y-3 rounded-md border p-3">
              {EXCLUDE_GROUPS.map((group) => {
                const active = groups.includes(group.id);
                return (
                  <div key={group.id} className="space-y-1">
                    <label className="flex items-start gap-2">
                      <Checkbox
                        className="mt-0.5"
                        checked={active}
                        onCheckedChange={(checked) => setGroups((prev) =>
                          checked ? [...prev, group.id] : prev.filter((id) => id !== group.id)
                        )}
                      />
                      <span>
                        <span className="text-sm font-medium">{group.label}</span>
                        <span className="block text-xs text-muted-foreground">{group.description}</span>
                      </span>
                    </label>
                    {active && (
                      <div className="flex flex-wrap gap-1 pl-6">
                        {group.patterns.map((pattern) => {
                          const off = optedOut.includes(pattern);
                          return (
                            <button
                              key={pattern}
                              type="button"
                              title={off ? "Click to include again" : "Click to skip this pattern"}
                              onClick={() => setOptedOut((prev) =>
                                off ? prev.filter((p) => p !== pattern) : [...prev, pattern]
                              )}
                              className={cn(
                                "rounded border px-1.5 py-0.5 font-mono text-xs transition-colors",
                                off
                                  ? "text-muted-foreground line-through opacity-60"
                                  : "hover:bg-muted"
                              )}
                            >
                              {pattern}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="epp-patterns">Your own patterns</Label>
            <Textarea
              id="epp-patterns"
              value={patternsText}
              onChange={(e) => setPatternsText(e.target.value)}
              placeholder={"node_modules/**\n*.tmp\n.cache/**"}
              rows={5}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">One glob pattern per line.</p>
          </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {preset ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
