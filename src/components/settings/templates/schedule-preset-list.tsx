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
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, CalendarClock } from "lucide-react";
import { SchedulePreset } from "@prisma/client";
import {
  getSchedulePresets,
  deleteSchedulePreset,
} from "@/app/actions/templates";
import { SchedulePresetDialog } from "./schedule-preset-dialog";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { bulkDeleteSchedulePresets } from "@/app/actions/templates-bulk";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";

export function SchedulePresetList() {
  const [presets, setPresets] = useState<SchedulePreset[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SchedulePreset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SchedulePreset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    const res = await getSchedulePresets();
    if (res.success && res.data) {
      setPresets(res.data);
    } else {
      toast.error("Failed to load schedule presets");
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
    const res = await deleteSchedulePreset(deleteTarget.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Schedule preset deleted");
      setDeleteTarget(null);
      fetchPresets();
    } else {
      toast.error(res.error || "Failed to delete preset");
    }
  };

  const bulkActions = useMemo<BulkAction<SchedulePreset>[]>(() => [
    {
      id: "delete",
      labels: { verb: "delete", verbPast: "deleted", noun: "schedule preset" },
      icon: Trash2,
      variant: "destructive",
      itemName: (row) => row.name,
      confirm: {
        title: (rows) => `Delete ${rows.length} schedule preset${rows.length === 1 ? "" : "s"}?`,
        description: () =>
          "An entry that is still in use is kept and listed afterwards.",
        confirmLabel: "Delete",
      },
      run: (rows) => unwrapBulkAction(bulkDeleteSchedulePresets(rows.map((row) => row.id))),
    },
  ], []);

  const columns: ColumnDef<SchedulePreset>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "schedule",
      header: "Cron Expression",
      cell: ({ row }) => (
        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
          {row.original.schedule}
        </code>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.description || "-"}
        </span>
      ),
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
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteTarget(row.original)}
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
              <CalendarClock className="h-5 w-5" />
              Schedule Presets
            </CardTitle>
            <CardDescription>
              Reusable schedules for backup jobs. A job that follows a preset
              runs on its schedule, also after the preset changes.
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

      <SchedulePresetDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
          setIsCreateOpen(false);
          fetchPresets();
        }}
      />

      {editTarget && (
        <SchedulePresetDialog
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
            <DialogTitle>Delete Schedule Preset</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
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
