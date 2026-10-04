"use client";

import { Lock, Users } from "lucide-react";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { LEVEL_LABELS, levelOf, rankOf, SUMMARY_AREAS } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import type { GroupMember, GroupRow } from "@/services/user/groups-types";

export const TOTAL_PERMISSIONS = AVAILABLE_PERMISSIONS.length;

const TILE_SIZES = { sm: ["size-7", "size-3.5"], md: ["size-8", "size-4"], lg: ["size-11", "size-5"] } as const;

/** A group as a tile, a lock for the built-in SuperAdmin group. */
export function GroupTile({ group, size = "md" }: { group: Pick<GroupRow, "superAdmin">; size?: keyof typeof TILE_SIZES }) {
    const [box, icon] = TILE_SIZES[size];
    const Icon = group.superAdmin ? Lock : Users;
    return (
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg border bg-muted/50", box)} aria-hidden="true">
            <Icon className={icon} />
        </span>
    );
}

export const countWord = (value: number, one: string, many: string) => `${value.toLocaleString()} ${value === 1 ? one : many}`;

/** How many permissions a group holds, all of them for the SuperAdmin group. */
export const permissionCount = (group: Pick<GroupRow, "superAdmin" | "permissions">) =>
    group.superAdmin ? TOTAL_PERMISSIONS : AVAILABLE_PERMISSIONS.filter((permission) => group.permissions.includes(permission.id)).length;

/** The first members as faces on top of each other, then how many there are. */
export function MemberFaces({ members, max = 4, className }: { members: GroupMember[]; max?: number; className?: string }) {
    if (members.length === 0) return <span className={cn("text-sm text-muted-foreground", className)}>nobody yet</span>;
    return (
        <span className={cn("flex min-w-0 items-center gap-2", className)} title={members.map((member) => member.name).join(", ")}>
            <span className="flex shrink-0" aria-hidden="true">
                {members.slice(0, max).map((member, index) => (
                    <span key={member.id} className={cn("rounded-full ring-2 ring-card", index > 0 && "-ml-1.5")}>
                        <UserAvatar user={member} size="sm" />
                    </span>
                ))}
            </span>
            <span className="truncate text-sm whitespace-nowrap">{countWord(members.length, "member", "members")}</span>
        </span>
    );
}

/** The share of the permissions as a bar and a count, like "19 of 39". */
export function ShareBar({ count }: { count: number }) {
    return (
        <span className="flex items-center gap-2.5 whitespace-nowrap">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="block h-full rounded-full bg-foreground/80" style={{ width: `${Math.round((100 * count) / TOTAL_PERMISSIONS)}%` }} />
            </span>
            <span className="text-sm tabular-nums">
                {count}
                <span className="text-muted-foreground"> of {TOTAL_PERMISSIONS}</span>
            </span>
        </span>
    );
}

/** Four dots, as many filled as the level is high. */
export function LevelDots({ rank, className }: { rank: number; className?: string }) {
    return (
        <span className={cn("flex gap-0.5", className)} aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
                <span key={index} className={cn("size-1.5 rounded-full", index < rank ? "bg-foreground" : "bg-foreground/15")} />
            ))}
        </span>
    );
}

const SHORT: Record<string, string> = {
    connections: "Conn",
    jobs: "Jobs",
    backups: "Back",
    history: "Hist",
    templates: "Tmpl",
    vault: "Vault",
    users: "Users",
    "api-keys": "Keys",
    audit: "Audit",
    settings: "Sett",
};

/** The level of every area as a small column of four bars, for the cards and the first step of New group. */
export function LevelStrip({ permissions, superAdmin = false, className }: { permissions: readonly string[]; superAdmin?: boolean; className?: string }) {
    const held = new Set(permissions);
    return (
        <div className={cn("grid grid-cols-10 gap-1", className)}>
            {SUMMARY_AREAS.map((area) => {
                const rank = superAdmin ? 4 : rankOf(area, held);
                const level = superAdmin ? "full" : levelOf(area, held);
                return (
                    <div key={area.id} className="flex min-w-0 flex-col items-center gap-1" title={`${area.label}: ${LEVEL_LABELS[level]}`}>
                        <span className="flex w-5 flex-col gap-0.5" aria-hidden="true">
                            {[3, 2, 1, 0].map((index) => (
                                <span key={index} className={cn("h-1 rounded-sm", index < rank ? "bg-foreground/85" : "bg-foreground/10")} />
                            ))}
                        </span>
                        <span className="max-w-full truncate text-[10px] text-muted-foreground" aria-hidden="true">{SHORT[area.id] ?? area.label}</span>
                        <span className="sr-only">{`${area.label}: ${LEVEL_LABELS[level]}`}</span>
                    </div>
                );
            })}
        </div>
    );
}
