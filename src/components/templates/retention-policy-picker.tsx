"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import type { RetentionPolicy } from "@prisma/client";
import { toast } from "sonner";
import { getRetentionPolicies } from "@/app/actions/templates";
import { useCan } from "@/components/permissions/permissions-context";
import { RetentionPolicyDialog } from "@/components/settings/templates/retention-policy-dialog";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { RetentionConfiguration } from "@/lib/core/retention";

export const DEFAULT_RETENTION_SENTINEL = "__DEFAULT__";
const NONE = "__NONE__";

/** A policy with how many destinations of jobs follow it. */
type ListedPolicy = RetentionPolicy & { _count?: { jobDestinations: number } };

const byName = (a: RetentionPolicy, b: RetentionPolicy) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** What a policy keeps, in a few words: "Keeps the last 14" or "7 daily, 4 weekly, 12 monthly". */
export function describeRetention(config: string): string {
    try {
        const parsed = JSON.parse(config) as RetentionConfiguration;
        if (parsed.mode === "SIMPLE" && parsed.simple) return `Keeps the last ${parsed.simple.keepCount}`;
        if (parsed.mode === "SMART" && parsed.smart) {
            const { hourly, daily, weekly, monthly, yearly } = parsed.smart;
            const tiers = (
                [
                    [hourly, "hourly"],
                    [daily, "daily"],
                    [weekly, "weekly"],
                    [monthly, "monthly"],
                    [yearly, "yearly"],
                ] as const
            )
                .filter(([count]) => typeof count === "number" && count > 0)
                .map(([count, name]) => `${count} ${name}`);
            return tiers.length > 0 ? tiers.join(", ") : "Smart, without a tier";
        }
    } catch {
        // A policy that cannot be read keeps everything, like the retention step does.
    }
    return "Keeps everything";
}

function usage(policy: ListedPolicy): string {
    const count = policy._count?.jobDestinations ?? 0;
    if (count === 0) return "Not used yet";
    return count === 1 ? "Used by 1 destination" : `Used by ${count} destinations`;
}

interface Props {
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    placeholder?: string;
    /** Offers No policy, for a destination that keeps everything. */
    allowNone?: boolean;
    /** Offers the default policy, which follows whatever policy is marked as the default. */
    allowDefault?: boolean;
    /** Names the field for screen readers where there is no label, like in a row of destinations. */
    "aria-label"?: string;
}

/**
 * Picks the retention policy of a destination, like the login field of a connection: the policies
 * in a list that says what each one keeps and how many destinations follow it, Edit on a row and
 * New policy at its foot, both for a viewer who may write templates.
 */
export function RetentionPolicyPicker({
    value,
    onChange,
    placeholder = "Pick a retention policy",
    allowNone = false,
    allowDefault = false,
    "aria-label": ariaLabel = "Retention policy",
}: Props) {
    const [policies, setPolicies] = useState<ListedPolicy[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState<{ open: boolean; policy?: RetentionPolicy }>({ open: false });
    const canWrite = useCan(PERMISSIONS.TEMPLATES.WRITE);

    useEffect(() => {
        getRetentionPolicies()
            .then((res) => {
                if (res.success && res.data) setPolicies(res.data);
                else toast.error("Failed to load retention policies");
            })
            .catch(() => toast.error("Failed to load retention policies"))
            .finally(() => setLoading(false));
    }, []);

    const defaultPolicy = policies.find((policy) => policy.isDefault);
    const isDefault = value === DEFAULT_RETENTION_SENTINEL;
    const selected = policies.find((policy) => policy.id === value);

    const special: PickEntry[] = [
        ...(allowDefault
            ? [{
                id: DEFAULT_RETENTION_SENTINEL,
                name: "Default policy",
                meta: defaultPolicy ? `${defaultPolicy.name} · ${describeRetention(defaultPolicy.config)}` : "No default is set, keeps everything",
                editable: false,
            }]
            : []),
        ...(allowNone ? [{ id: NONE, name: "No policy", meta: "Keeps everything", editable: false }] : []),
    ];
    const entries: PickEntry[] = policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        meta: `${describeRetention(policy.config)} · ${usage(policy)}`,
        keywords: policy.description ? [policy.description] : undefined,
        // A policy that ships with DBackup stays as it is.
        editable: !policy.isSystem,
    }));

    const openDialog = (policy?: RetentionPolicy) => {
        setOpen(false);
        setDialog({ open: true, policy });
    };

    const saved = (policy: RetentionPolicy) => {
        // The saved policy comes without its destinations, which a change does not touch.
        setPolicies((list) => [...list.filter((entry) => entry.id !== policy.id), { ...policy, _count: list.find((entry) => entry.id === policy.id)?._count }].sort(byName));
        // A new policy is picked right away, an edited one only refreshes what the field shows.
        if (!dialog.policy) onChange(policy.id);
        setDialog((current) => ({ ...current, open: false }));
    };

    return (
        <>
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger icon={Timer} loading={loading} disabled={loading} aria-expanded={open} aria-label={ariaLabel} className="w-full">
                        {loading ? (
                            <span className="text-muted-foreground">Loading...</span>
                        ) : isDefault ? (
                            // The field keeps its width, so the name stays whole and only the policy behind it is cut.
                            <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="shrink-0">Default policy</span>
                                <span className="min-w-0 truncate text-xs text-muted-foreground">{defaultPolicy ? defaultPolicy.name : "keeps all"}</span>
                            </span>
                        ) : selected ? (
                            <span className="truncate">{selected.name}</span>
                        ) : (
                            <span className="truncate text-muted-foreground">{allowNone && !value ? "No policy, keeps all" : placeholder}</span>
                        )}
                    </PickTrigger>
                </PopoverTrigger>
                {/* On the raised surface, so it stands out from the dialog it opens over. */}
                <PopoverContent tone="pick" align="end" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                    <PickList
                        icon={Timer}
                        title="Pick from Templates"
                        note="Retention policies"
                        groups={[{ entries: special }, { heading: special.length > 0 && entries.length > 0 ? "Policies" : undefined, entries }]}
                        value={isDefault ? DEFAULT_RETENTION_SENTINEL : allowNone && !value ? NONE : value}
                        emptyText={policies.length === 0 && special.length === 0 ? "There is no retention policy yet." : "Nothing matches."}
                        onPick={(id) => {
                            onChange(id === NONE ? null : id);
                            setOpen(false);
                        }}
                        onEdit={canWrite ? (id) => openDialog(policies.find((policy) => policy.id === id)) : undefined}
                        createLabel="New policy"
                        onCreate={canWrite ? () => openDialog() : undefined}
                    />
                </PopoverContent>
            </Popover>

            <RetentionPolicyDialog
                open={dialog.open}
                onOpenChange={(next) => setDialog((current) => ({ ...current, open: next }))}
                policy={dialog.policy}
                onSuccess={saved}
            />
        </>
    );
}
