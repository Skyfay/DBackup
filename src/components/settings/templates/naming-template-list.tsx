"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
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
import { Loader2, Plus, Trash2, Pencil, FileText, Star } from "lucide-react";
import { NamingTemplate } from "@prisma/client";
import {
  getNamingTemplates,
  updateNamingTemplate,
  deleteNamingTemplate,
} from "@/app/actions/templates";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { bulkDeleteNamingTemplates } from "@/app/actions/templates-bulk";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import { previewPattern } from "@/lib/templates/naming-template-engine";
import { NamingTemplateDialog } from "./naming-template-dialog";

export function NamingTemplateList() {
  const [templates, setTemplates] = useState<NamingTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NamingTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NamingTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const res = await getNamingTemplates();
    if (res.success && res.data) {
      setTemplates(res.data);
    } else {
      toast.error("Failed to load naming templates");
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
    const res = await deleteNamingTemplate(deleteTarget.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Naming template deleted");
      setDeleteTarget(null);
      fetchTemplates();
    } else {
      toast.error(res.error || "Failed to delete template");
    }
  };

  const handleSetDefault = async (template: NamingTemplate) => {
    setIsSettingDefault(template.id);
    const res = await updateNamingTemplate(template.id, { isDefault: !template.isDefault });
    if (res.success) {
      toast.success(template.isDefault ? "Default template cleared" : `"${template.name}" set as default naming template`);
      fetchTemplates();
    } else {
      toast.error(res.error || "Failed to update default template");
    }
    setIsSettingDefault(null);
  };

  const bulkActions = useMemo<BulkAction<NamingTemplate>[]>(() => [
    {
      id: "delete",
      labels: { verb: "delete", verbPast: "deleted", noun: "naming template" },
      icon: Trash2,
      variant: "destructive",
      itemName: (row) => row.name,
      // Built-in entries ship with the product and the service refuses them anyway.
      ineligible: (row) => (row.isSystem ? "Built-in, cannot be deleted" : null),
      confirm: {
        title: (rows) => `Delete ${rows.length} naming template${rows.length === 1 ? "" : "s"}?`,
        description: () =>
          "An entry that is still in use is kept and listed afterwards.",
        confirmLabel: "Delete",
      },
      run: (rows) => unwrapBulkAction(bulkDeleteNamingTemplates(rows.map((row) => row.id))),
    },
  ], []);

  const columns: ColumnDef<NamingTemplate>[] = [
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
      accessorKey: "pattern",
      header: "Pattern",
      cell: ({ row }) => (
        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
          {row.original.pattern}
        </code>
      ),
    },
    {
      id: "preview",
      header: "Preview",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {previewPattern(row.original.pattern)}.tar
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
            title={row.original.isDefault ? "Remove as default" : "Set as default"}
            onClick={() => handleSetDefault(row.original)}
            disabled={isSettingDefault === row.original.id}
          >
            {isSettingDefault === row.original.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Star className={`h-4 w-4 ${row.original.isDefault ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`} />
            )}
          </Button>
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
            disabled={row.original.isSystem || row.original.isDefault}
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
              <FileText className="h-5 w-5" />
              Naming Templates
            </CardTitle>
            <CardDescription>
              Define reusable filename patterns for backup files. The default
              template is pre-selected for all new jobs.
            </CardDescription>
          </div>
          <Button tone="create" onClick={() => setIsCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={templates}
            isLoading={loading}
            enableRowSelection
            getRowId={(row) => row.id}
            bulkActions={bulkActions}
            onBulkActionComplete={fetchTemplates}
          />
        </CardContent>
      </Card>

      <NamingTemplateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
          setIsCreateOpen(false);
          fetchTemplates();
        }}
      />

      {editTarget && (
        <NamingTemplateDialog
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          template={editTarget}
          onSuccess={() => {
            setEditTarget(null);
            fetchTemplates();
          }}
        />
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent tone="destructive">
          <DialogHeader>
            <DialogTitle>Delete Naming Template</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
              The template must not be used by any active jobs.
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
