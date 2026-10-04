"use client";

import { LogIn, Pencil, ScrollText, ShieldAlert, ShieldX } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { listWords } from "@/lib/auth/access-summary";
import type { AuditStats } from "@/services/audit/audit-types";

const many = (value: number, one: string, more: string) => `${value.toLocaleString()} ${value === 1 ? one : more}`;

/** The numbers above the entries: everything, the sign-ins, the changes, what hands out data and the failed sign-ins. */
export function AuditStrip({ stats }: { stats: AuditStats | null }) {
    const sensitive = stats
        ? [
              ...(stats.sensitive.reveals > 0 ? [many(stats.sensitive.reveals, "secret revealed", "secrets revealed")] : []),
              ...(stats.sensitive.downloads > 0 ? [many(stats.sensitive.downloads, "download", "downloads")] : []),
              ...(stats.sensitive.restores > 0 ? [many(stats.sensitive.restores, "restore", "restores")] : []),
          ]
        : [];
    const last = stats?.failed.last;
    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Entries",
                    icon: ScrollText,
                    value: stats ? stats.entries.toLocaleString() : "-",
                    extra: stats ? `in the last ${stats.days} days, kept ${stats.keptDays} days` : " ",
                },
                {
                    label: "Sign-ins",
                    icon: LogIn,
                    value: stats ? stats.signIns.count.toLocaleString() : "-",
                    extra: stats
                        ? `by ${many(stats.signIns.people, "person", "people")}${stats.signIns.newPlaces > 0 ? `, ${stats.signIns.newPlaces} from a new place` : ""}`
                        : " ",
                },
                {
                    label: "Changes",
                    icon: Pencil,
                    value: stats ? stats.changes.count.toLocaleString() : "-",
                    extra: stats ? (stats.changes.areas.length > 0 ? `most to ${listWords(stats.changes.areas)}` : "nothing changed") : " ",
                },
                {
                    label: "Sensitive",
                    icon: ShieldAlert,
                    value: stats ? stats.sensitive.count.toLocaleString() : "-",
                    tone: stats && stats.sensitive.count > 0 ? "warning" : undefined,
                    extra: stats ? (sensitive.length > 0 ? sensitive.join(", ") : "no secret revealed, nothing downloaded") : " ",
                },
                {
                    label: "Failed sign-ins",
                    icon: ShieldX,
                    value: stats ? stats.failed.count.toLocaleString() : "-",
                    tone: stats && stats.failed.count > 0 ? "warning" : undefined,
                    extra: stats
                        ? last
                            ? `the last ${formatDistanceToNowStrict(new Date(last.at), { addSuffix: true })}${last.ipAddress ? ` from ${last.ipAddress}` : ""}`
                            : "none"
                        : " ",
                },
            ]}
        />
    );
}
