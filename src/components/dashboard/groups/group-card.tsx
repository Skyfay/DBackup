"use client";

import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { isPlainClick } from "@/components/ui/row-click";
import type { GroupRow } from "@/services/user/groups-types";
import { GroupTile, LevelStrip, MemberFaces, permissionCount, TOTAL_PERMISSIONS } from "./group-cells";
import { groupLine, MadeText } from "./group-columns";

interface GroupCardProps {
    group: GroupRow;
    onOpen: (group: GroupRow) => void;
    actions: React.ReactNode;
}

/** A group as a card: what its members may do, the level of every area, who is in it. */
export function GroupCard({ group, onOpen, actions }: GroupCardProps) {
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(group)}
            className="flex min-w-0 cursor-pointer flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <GroupTile group={group} size="lg" />
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(group)}
                        className="block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        {group.name}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">
                        <MadeText group={group} />
                    </p>
                </div>
                <div className="-mt-1 -mr-2">{actions}</div>
            </div>
            <p className="min-h-10 text-sm">{groupLine(group)}</p>
            <LevelStrip permissions={group.permissions} superAdmin={group.superAdmin} />
            <div className="flex items-center gap-3 border-t pt-3">
                <MemberFaces members={group.members} />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {permissionCount(group)} of {TOTAL_PERMISSIONS}
                    {group.changed && (
                        <>
                            {" · changed "}
                            <RelativeTime date={group.changed.at} />
                        </>
                    )}
                </span>
            </div>
        </div>
    );
}
