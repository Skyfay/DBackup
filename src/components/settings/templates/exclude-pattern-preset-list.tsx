"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Loader2, Plus, Trash2, Pencil, Filter } from "lucide-react";
import { ExcludePatternPreset } from "@prisma/client";
import {
  getExcludePatternPresets,
  createExcludePatternPreset,
  updateExcludePatternPreset,
  deleteExcludePatternPreset,
} from "@/app/actions/templates";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";

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

  const columns: ColumnDef<ExcludePatternPreset>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "patterns",
      header: "Patterns",
      cell: ({ row }) => {
        const patterns = parsePatterns(row.original.patterns);
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
            onClick={() => setEditTarget(row.original)}
            disabled={row.original.isSystem}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
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
          <Button onClick={() => setIsCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Preset
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={presets} isLoading={loading} />
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
        <DialogContent>
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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(preset?.name ?? "");
      setDescription(preset?.description ?? "");
      setPatternsText(preset ? parsePatterns(preset.patterns).join("\n") : (initialPatterns ?? []).join("\n"));
    }
  }, [open, preset, initialPatterns]);

  const handleSave = async () => {
    if (!name.trim()) return;
    const patterns = patternsText.split("\n").map((l) => l.trim()).filter(Boolean);
    setIsSaving(true);
    const res = preset
      ? await updateExcludePatternPreset(preset.id, { name, description, patterns })
      : await createExcludePatternPreset({ name, description, patterns });
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {preset ? "Edit Exclude Pattern Preset" : "New Exclude Pattern Preset"}
          </DialogTitle>
          <DialogDescription>
            Define a reusable set of glob patterns to exclude from directory-source backups.
          </DialogDescription>
        </DialogHeader>
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
          <div className="space-y-1.5">
            <Label htmlFor="epp-patterns">Patterns</Label>
            <Textarea
              id="epp-patterns"
              value={patternsText}
              onChange={(e) => setPatternsText(e.target.value)}
              placeholder={"node_modules/**\n*.tmp\n.cache/**"}
              rows={6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">One glob pattern per line.</p>
          </div>
        </div>
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
