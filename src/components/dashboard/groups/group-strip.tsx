"use client";

import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { listed } from "@/components/dashboard/users/user-strip";
import type { GroupsModel } from "@/services/user/groups-types";

/** The numbers above the groups: who is in none, which groups may delete backups or reveal secrets, which are empty. */
export function GroupsStrip({ model }: { model: GroupsModel | null }) {
    const stats = model?.stats;
    const outside = stats ? stats.people - stats.inGroup : 0;
    const builtIn = model?.groups.filter((group) => group.superAdmin).length ?? 0;
    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Groups",
                    value: stats ? stats.groups.toLocaleString() : "-",
                    extra: stats ? `${builtIn} built in, ${(stats.groups - builtIn).toLocaleString()} of yours` : " ",
                },
                {
                    label: "People in a group",
                    value: stats ? stats.inGroup.toLocaleString() : "-",
                    unit: stats ? `of ${stats.people.toLocaleString()}` : undefined,
                    extra: outside === 0
                        ? "everyone has a group"
                        : stats && stats.withoutGroup.length > 0
                          ? `${listed(stats.withoutGroup)} ${stats.withoutGroup.length === 1 ? "is" : "are"} in none`
                          : `${outside.toLocaleString()} in none`,
                },
                {
                    label: "Can delete backups",
                    value: stats ? stats.canDelete.length.toLocaleString() : "-",
                    unit: stats ? (stats.canDelete.length === 1 ? "group" : "groups") : undefined,
                    extra: stats && stats.canDelete.length > 0 ? listed(stats.canDelete) : "no group",
                },
                {
                    label: "Can reveal secrets",
                    value: stats ? stats.canReveal.length.toLocaleString() : "-",
                    unit: stats ? (stats.canReveal.length === 1 ? "group" : "groups") : undefined,
                    extra: stats && stats.canReveal.length > 0 ? listed(stats.canReveal) : "no group",
                },
                {
                    label: "Empty",
                    value: stats ? stats.empty.length.toLocaleString() : "-",
                    unit: stats ? (stats.empty.length === 1 ? "group" : "groups") : undefined,
                    tone: stats && stats.empty.length > 0 ? "warning" : undefined,
                    extra: stats && stats.empty.length > 0
                        ? `${listed(stats.empty)} ${stats.empty.length === 1 ? "has" : "have"} no members yet`
                        : "every group has members",
                },
            ]}
        />
    );
}
