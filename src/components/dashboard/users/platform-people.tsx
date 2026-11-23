"use client";

import { Globe } from "lucide-react";
import { MemberFaces } from "@/components/dashboard/groups/group-cells";
import { PlatformGroupTile } from "@/components/dashboard/platform/platform-group-cells";
import { usePageModel } from "@/hooks/use-page-model";
import { cn } from "@/lib/utils";
import type { PlatformPeople } from "@/services/user/platform-people";

/**
 * Who of the MSP opens this tenant through the platform without being a member: one row per
 * platform group, Platform admin first, with its members and what they may do here. Read only,
 * since the platform gives it, under Platform, Users & Groups. Nothing while nobody does, like on
 * every instance with one tenant.
 */
export function PlatformPeoplePart({ tenantName, className }: { tenantName: string | null; className?: string }) {
    const { model } = usePageModel<PlatformPeople>("/api/users/platform-people", "The people of the platform could not be loaded.");
    if (!model || model.groups.length === 0) return null;
    const people = new Set(model.groups.flatMap((group) => group.members.map((member) => member.id))).size;

    return (
        <section className={cn("min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)} aria-label="Through the platform">
            <div className="flex flex-col gap-1 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between md:px-5">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                        <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        Through the platform
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        They open {tenantName ?? "this tenant"} without being members. Read only here, given under Platform, Users & Groups.
                    </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {people} {people === 1 ? "person" : "people"} of {model.home}
                </span>
            </div>
            <ul className="divide-y">
                {model.groups.map((group) => (
                    <li key={group.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[auto_minmax(0,14rem)_minmax(0,12rem)_minmax(0,1fr)] md:px-5">
                        <PlatformGroupTile group={group} />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{group.name}</p>
                            <p className="truncate text-xs text-muted-foreground">platform group</p>
                        </div>
                        <MemberFaces members={group.members.map((member) => ({ ...member, isYou: false }))} className="col-start-2 md:col-start-auto" />
                        <p className="col-start-2 truncate text-sm md:col-start-auto" title={group.line}>{group.line}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
