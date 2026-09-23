"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Timer, Star } from "lucide-react";
import { RetentionPolicy } from "@prisma/client";
import {
  getRetentionPolicies,
  createRetentionPolicy,
  updateRetentionPolicy,
  deleteRetentionPolicy,
  setDefaultRetentionPolicy,
  unsetDefaultRetentionPolicy,
} from "@/app/actions/templates";
import { RetentionConfiguration } from "@/lib/core/retention";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { bulkDeleteRetentionPolicies } from "@/app/actions/templates-bulk";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import { RetentionPolicyForm } from "./retention-policy-form";

export function RetentionPolicyList() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RetentionPolicy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RetentionPolicy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    const res = await getRetentionPolicies();
    if (res.success && res.data) {
      setPolicies(res.data);
    } else {
      toast.error("Failed to load retention policies");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPolicies();
  }, [fetchPolicies]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const res = await deleteRetentionPolicy(deleteTarget.id);
    setIsDeleting(false);
    if (res.success) {
      toast.success("Retention policy deleted");
      setDeleteTarget(null);
      fetchPolicies();
    } else {
      toast.error(res.error || "Failed to delete policy");
    }
  };

  const handleSetDefault = async (policy: RetentionPolicy) => {
    setIsSettingDefault(policy.id);
    if (policy.isDefault) {
      const res = await unsetDefaultRetentionPolicy();
      if (res.success) {
        toast.success("Default retention policy cleared");
        fetchPolicies();
      } else {
        toast.error(res.error || "Failed to clear default policy");
      }
    } else {
      const res = await setDefaultRetentionPolicy(policy.id);
      if (res.success) {
        toast.success(`"${policy.name}" set as default retention policy`);
        fetchPolicies();
      } else {
        toast.error(res.error || "Failed to set default policy");
      }
    }
    setIsSettingDefault(null);
  };

  function getModeLabel(config: string) {
    try {
      const parsed = JSON.parse(config) as RetentionConfiguration;
      if (parsed.mode === "NONE") return "Keep All";
      if (parsed.mode === "SIMPLE")
        return `Simple - keep ${parsed.simple?.keepCount ?? "?"} backups`;
      if (parsed.mode === "SMART") {
        const s = parsed.smart;
        // Suffixed because a bare "24/7/4/12/2" cannot be told apart from "7/4/12/2"
        // once an hourly tier can be present. Hourly only shows when it is in use.
        const tiers = [
          ...(s?.hourly ? [`${s.hourly}h`] : []),
          `${s?.daily ?? 0}d`,
          `${s?.weekly ?? 0}w`,
          `${s?.monthly ?? 0}m`,
          `${s?.yearly ?? 0}y`,
        ];
        return `Smart GFS (${tiers.join("/")})`;
      }
    } catch {
      // ignore
    }
    return "Unknown";
  }

  function getModeBadgeVariant(
    _config: string
  ): "default" | "secondary" | "outline" {
    return "outline";
  }

  const bulkActions = useMemo<BulkAction<RetentionPolicy>[]>(() => [
    {
      id: "delete",
      labels: { verb: "delete", verbPast: "deleted", noun: "retention policy", nounPlural: "retention policies" },
      icon: Trash2,
      variant: "destructive",
      itemName: (row) => row.name,
      confirm: {
        title: (rows) => `Delete ${rows.length} retention polic${rows.length === 1 ? "y" : "ies"}?`,
        description: () =>
          "An entry that is still in use is kept and listed afterwards.",
        confirmLabel: "Delete",
      },
      run: (rows) => unwrapBulkAction(bulkDeleteRetentionPolicies(rows.map((row) => row.id))),
    },
  ], []);

  const columns: ColumnDef<RetentionPolicy>[] = [
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
      accessorKey: "config",
      header: "Policy",
      cell: ({ row }) => (
        <Badge variant={getModeBadgeVariant(row.original.config)}>
          {getModeLabel(row.original.config)}
        </Badge>
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
              <Timer className="h-5 w-5" />
              Retention Policies
            </CardTitle>
            <CardDescription>
              Reusable retention policies. Assign them to destinations in your
              backup jobs.
            </CardDescription>
          </div>
          <Button tone="create" onClick={() => setIsCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Policy
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={policies}
            isLoading={loading}
            enableRowSelection
            getRowId={(row) => row.id}
            bulkActions={bulkActions}
            onBulkActionComplete={fetchPolicies}
          />
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <RetentionPolicyDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
          setIsCreateOpen(false);
          fetchPolicies();
        }}
      />

      {/* Edit Dialog */}
      {editTarget && (
        <RetentionPolicyDialog
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          policy={editTarget}
          onSuccess={() => {
            setEditTarget(null);
            fetchPolicies();
          }}
        />
      )}

      {/* Delete Confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent tone="destructive">
          <DialogHeader>
            <DialogTitle>Delete Retention Policy</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
              The policy must not be referenced by any job destination or
              storage destination.
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

interface RetentionPolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: RetentionPolicy;
  onSuccess: (policy: RetentionPolicy) => void;
}

export function RetentionPolicyDialog({
  open,
  onOpenChange,
  policy,
  onSuccess,
}: RetentionPolicyDialogProps) {
  const [name, setName] = useState(policy?.name ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  const [config, setConfig] = useState<RetentionConfiguration>(() => {
    if (policy) {
      try {
        return JSON.parse(policy.config) as RetentionConfiguration;
      } catch {
        return { mode: "NONE" };
      }
    }
    return { mode: "NONE" };
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(policy?.name ?? "");
      setDescription(policy?.description ?? "");
      setConfig(
        policy
          ? (() => {
              try {
                return JSON.parse(policy.config) as RetentionConfiguration;
              } catch {
                return { mode: "NONE" };
              }
            })()
          : { mode: "NONE" }
      );
    }
  }, [open, policy]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    const res = policy
      ? await updateRetentionPolicy(policy.id, { name, description, config })
      : await createRetentionPolicy({ name, description, config });
    setIsSaving(false);
    if (res.success && res.data) {
      toast.success(
        policy ? "Retention policy updated" : "Retention policy created"
      );
      onSuccess(res.data);
    } else {
      toast.error(res.error || "Failed to save retention policy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent tone={policy ? "edit" : "create"} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {policy ? "Edit Retention Policy" : "New Retention Policy"}
          </DialogTitle>
          <DialogDescription>
            Configure a reusable retention policy that can be assigned to
            destinations.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rp-name">Name</Label>
            <Input
              id="rp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Smart GFS Production"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-desc">Description (optional)</Label>
            <Textarea
              id="rp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              rows={2}
            />
          </div>
          <RetentionPolicyForm value={config} onChange={setConfig} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {policy ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
