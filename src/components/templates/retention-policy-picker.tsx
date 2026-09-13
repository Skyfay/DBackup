"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, Timer, ChevronsUpDown, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { RetentionPolicy } from "@prisma/client";
import { getRetentionPolicies } from "@/app/actions/templates";
import { RetentionPolicyDialog } from "@/components/settings/templates/retention-policy-list";

export const DEFAULT_RETENTION_SENTINEL = "__DEFAULT__";

interface Props {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  allowDefault?: boolean;
}

export function RetentionPolicyPicker({
  value,
  onChange,
  placeholder = "Select retention policy...",
  allowNone = false,
  allowDefault = false,
}: Props) {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RetentionPolicy | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const defaultPolicy = policies.find((p) => p.isDefault);

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
    fetchPolicies();
  }, [fetchPolicies]);

  const selected = policies.find((p) => p.id === value && value !== DEFAULT_RETENTION_SENTINEL);
  const isDefault = value === DEFAULT_RETENTION_SENTINEL;

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
            ) : isDefault ? (
              <span className="flex items-center gap-2 min-w-0">
                <Timer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{defaultPolicy ? `Default (${defaultPolicy.name})` : "No retention (keep all)"}</span>
              </span>
            ) : selected ? (
              <span className="flex items-center gap-2 min-w-0">
                <Timer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search policies..." />
            <CommandList>
              <CommandEmpty>No policies found.</CommandEmpty>
              <CommandGroup>
                {allowDefault && (
                  <CommandItem
                    value="__default__"
                    onSelect={() => {
                      onChange(DEFAULT_RETENTION_SENTINEL);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        isDefault ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span>Default</span>
                      <span className="text-xs text-muted-foreground">
                        {defaultPolicy ? defaultPolicy.name : "No default set - keeps all"}
                      </span>
                    </span>
                  </CommandItem>
                )}
                {allowNone && (
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      onChange(null);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        !value && !isDefault ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="text-muted-foreground">No policy (keep all)</span>
                  </CommandItem>
                )}
                {policies.map((policy) => (
                  <CommandItem
                    key={policy.id}
                    value={policy.name}
                    className="group pr-1"
                    onSelect={() => {
                      onChange(policy.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === policy.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex-1">{policy.name}</span>
                    {!policy.isSystem && (
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 rounded p-0.5 hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(false);
                          setEditTarget(policy);
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
                  Create new policy...
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <RetentionPolicyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(policy) => {
          setPolicies((prev) => [
            ...prev.filter((p) => p.id !== policy.id),
            policy,
          ].sort((a, b) => a.name.localeCompare(b.name)));
          onChange(policy.id);
          setCreateOpen(false);
        }}
      />

      <RetentionPolicyDialog
        open={editOpen}
        onOpenChange={(v) => { setEditOpen(v); if (!v) setEditTarget(null); }}
        policy={editTarget ?? undefined}
        onSuccess={(policy) => {
          setPolicies((prev) => prev.map((p) => p.id === policy.id ? policy : p));
          setEditTarget(null);
          setEditOpen(false);
        }}
      />
    </>
  );
}
