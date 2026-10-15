"use client";

import { type Ref } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlatformGroupList, type PlatformGroupListHandle } from "./platform-group-list";
import { TenantGroupsList } from "./tenant-groups-list";

/** Which groups the Groups tab of the Platform lists. */
export type GroupsKind = "platform" | "tenant";

/** The kind an address names, `?groups=tenant` for the groups of the tenants, the platform groups otherwise. */
export const groupsKindOf = (value: string | null): GroupsKind => (value === "tenant" ? "tenant" : "platform");

interface PlatformGroupsTabProps {
    ref?: Ref<PlatformGroupListHandle>;
    cards: boolean;
    kind: GroupsKind;
    onKindChange: (kind: GroupsKind) => void;
    /** May make, change, give and delete platform groups. */
    canManage: boolean;
}

/**
 * The Groups tab of Users & Groups under Platform, with a switch before the search between the
 * platform groups of the people of the MSP, which change here, and the groups of every tenant,
 * which only show here and change in their tenant.
 */
export function PlatformGroupsTab({ ref, cards, kind, onKindChange, canManage }: PlatformGroupsTabProps) {
    const toolbarStart = (
        <Tabs value={kind} onValueChange={(value) => onKindChange(groupsKindOf(value))} className="w-full sm:w-auto">
            <TabsList className="h-8 w-full sm:w-auto" aria-label="Which groups">
                <TabsTrigger value="platform" className="px-2.5 text-xs">Platform groups</TabsTrigger>
                <TabsTrigger value="tenant" className="px-2.5 text-xs">Tenant groups</TabsTrigger>
            </TabsList>
        </Tabs>
    );

    return kind === "platform"
        ? <PlatformGroupList ref={ref} cards={cards} canManage={canManage} toolbarStart={toolbarStart} />
        : <TenantGroupsList cards={cards} toolbarStart={toolbarStart} />;
}
