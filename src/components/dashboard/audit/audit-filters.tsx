"use client";

import { CircleHelp, KeyRound } from "lucide-react";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { ACTION_LABELS, AUDIT_AREAS } from "@/lib/core/audit-areas";
import type { AuditPage, AuditRow } from "@/services/audit/audit-types";

const UNAVAILABLE = "No entries with the other filters";

/**
 * The filters of the entries: who, with people and API keys under headings of their own, the area
 * and the action. The numbers come from the server, which counts under the other filters.
 */
export function auditFilters(page: AuditPage | null): DataTableFilterableColumn<AuditRow>[] {
    const facets = page?.facets;
    const shared = { note: "The numbers count the entries", unavailableLabel: UNAVAILABLE };
    return [
        {
            id: "who",
            title: "Who",
            heading: "Filter by who did it",
            ...shared,
            options: (page?.who ?? []).map((option) => ({
                value: option.value,
                label: option.deleted ? `${option.label} (deleted)` : option.label,
                group: option.group,
                lead:
                    option.group === "API keys" ? <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                    : option.group === "Other" ? <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
                    : <UserAvatar user={{ name: option.label, image: option.image }} size="sm" />,
                count: facets?.who[option.value] ?? 0,
            })),
        },
        {
            id: "area",
            title: "Area",
            ...shared,
            options: AUDIT_AREAS.map((area) => ({ value: area.id, label: area.label, count: facets?.area[area.id] ?? 0 })),
        },
        {
            id: "action",
            title: "Action",
            ...shared,
            options: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label, count: facets?.action[value] ?? 0 })),
        },
    ];
}
