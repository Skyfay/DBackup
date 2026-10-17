"use client";

import { Building2, Globe, Share2, ShieldCheck, UserCheck } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { listed } from "@/components/dashboard/users/user-strip";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PlatformGroupsModel } from "@/services/user/platform-groups-types";

const groupsWord = (count: number) => (count === 1 ? "group" : "groups");

/**
 * The numbers above the platform groups: how many there are, how many accounts hold one, which
 * reach every tenant, which share with customers and which change tenants. Platform admin counts as one
 * of them, built in.
 */
export function PlatformGroupStrip({ model }: { model: PlatformGroupsModel | null }) {
    const groups = model?.groups ?? [];
    const custom = groups.filter((group) => !group.builtIn);
    const holders = new Set(groups.flatMap((group) => group.members.map((member) => member.id))).size;
    const everywhere = groups.filter((group) => group.allTenants && (group.builtIn || group.tenantPermissions.length > 0));
    const sharing = groups.filter((group) => group.builtIn || group.platformPermissions.includes(PERMISSIONS.PLATFORM.SHARING_WRITE));
    const tenants = groups.filter((group) => group.builtIn || group.platformPermissions.includes(PERMISSIONS.PLATFORM.TENANTS_WRITE));
    const names = (list: typeof groups) => (list.length > 0 ? listed(list.map((group) => group.name)) : "no group");

    return (
        <ExplorerStrip
            joined
            cells={[
                {
                    label: "Platform groups, 1 built in",
                    icon: Globe,
                    value: model ? groups.length.toLocaleString() : "-",
                    extra: model ? `Platform admin and ${custom.length.toLocaleString()} of yours` : " ",
                },
                {
                    label: "Accounts with a platform group",
                    icon: UserCheck,
                    value: model ? holders.toLocaleString() : "-",
                    unit: model ? `of ${model.accounts.toLocaleString()}` : undefined,
                    extra: "A person holds one platform group, Platform admin included",
                },
                {
                    label: "In every tenant, new ones too",
                    icon: Building2,
                    value: model ? everywhere.length.toLocaleString() : "-",
                    unit: model ? groupsWord(everywhere.length) : undefined,
                    extra: model ? names(everywhere) : " ",
                },
                {
                    label: "Share with customers",
                    icon: Share2,
                    value: model ? sharing.length.toLocaleString() : "-",
                    unit: model ? groupsWord(sharing.length) : undefined,
                    extra: model ? names(sharing) : " ",
                },
                {
                    label: "Change tenants",
                    icon: ShieldCheck,
                    value: model ? tenants.length.toLocaleString() : "-",
                    unit: model ? groupsWord(tenants.length) : undefined,
                    extra: model ? names(tenants) : " ",
                },
            ]}
        />
    );
}
