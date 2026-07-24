"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  createNamingTemplate,
  updateNamingTemplate,
  deleteNamingTemplate,
} from "@/app/actions/templates";
import { DataTable } from "@/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { DateDisplay } from "@/components/utils/date-display";
import {
  NAMING_TOKEN_GROUPS,
  patternUsesChain,
  previewPattern,
} from "@/lib/templates/naming-template-engine";

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
          {previewPattern(row.original.pattern)}.sql
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
          <Button onClick={() => setIsCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={templates} isLoading={loading} />
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
        <DialogContent>
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

interface NamingTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: NamingTemplate;
  onSuccess: (template: NamingTemplate) => void;
}

export function NamingTemplateDialog({
  open,
  onOpenChange,
  template,
  onSuccess,
}: NamingTemplateDialogProps) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [pattern, setPattern] = useState(
    template?.pattern ?? "{job_name}_yyyy-MM-dd_HH-mm-ss"
  );
  const [isSaving, setIsSaving] = useState(false);
  const patternInputRef = useRef<HTMLInputElement>(null);

  // With {chain} in the pattern both outcomes matter: what an incremental run produces, and
  // what everything else produces once the token and its separator fall away.
  const usesChain = useMemo(() => patternUsesChain(pattern), [pattern]);
  const preview = useMemo(
    () => `${previewPattern(pattern, usesChain ? "inc-001" : "")}.sql`,
    [pattern, usesChain]
  );
  const previewWithoutChain = useMemo(() => `${previewPattern(pattern)}.sql`, [pattern]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setPattern(template?.pattern ?? "{job_name}_yyyy-MM-dd_HH-mm-ss");
    }
  }, [open, template]);

  const insertToken = (token: string) => {
    const input = patternInputRef.current;
    if (!input) {
      setPattern((prev) => prev + token);
      return;
    }
    const start = input.selectionStart ?? pattern.length;
    const end = input.selectionEnd ?? pattern.length;
    const newPattern = pattern.slice(0, start) + token + pattern.slice(end);
    setPattern(newPattern);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSave = async () => {
    if (!name.trim() || !pattern.trim()) return;
    setIsSaving(true);
    const res = template
      ? await updateNamingTemplate(template.id, {
          name,
          description,
          pattern,
        })
      : await createNamingTemplate({ name, description, pattern });
    setIsSaving(false);
    if (res.success && res.data) {
      toast.success(
        template ? "Naming template updated" : "Naming template created"
      );
      onSuccess(res.data);
    } else {
      toast.error(res.error || "Failed to save naming template");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit Naming Template" : "New Naming Template"}
          </DialogTitle>
          <DialogDescription>
            Define a filename pattern for backup files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="nt-name">Name</Label>
            <Input
              id="nt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production Standard"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-desc">Description (optional)</Label>
            <Textarea
              id="nt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-pattern">Pattern</Label>
            <Input
              ref={patternInputRef}
              id="nt-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="{job_name}_yyyy-MM-dd_HH-mm-ss"
              className="font-mono"
            />
            <div className="space-y-1 mt-1">
              {NAMING_TOKEN_GROUPS.map((group) => (
                <div key={group.group} className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted-foreground w-10 shrink-0">
                    {group.group}
                  </span>
                  {group.tokens.map((info) => (
                    <Tooltip key={info.token}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="cursor-pointer hover:bg-muted text-xs font-mono"
                          onClick={() => insertToken(info.token)}
                        >
                          {info.token}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>{info.description}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              ))}
            </div>
            <div className="space-y-1.5 mt-2">
              <Label>Preview</Label>
              <div className="flex items-center h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm font-mono text-muted-foreground">
                <span className="truncate">{preview}</span>
              </div>
              {usesChain && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Above: an incremental run. Every other job drops the token together with
                    the separator next to it:
                  </p>
                  <div className="flex items-center h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-sm font-mono text-muted-foreground">
                    <span className="truncate">{previewWithoutChain}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !pattern.trim() || preview.startsWith("Invalid pattern")}
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {template ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
