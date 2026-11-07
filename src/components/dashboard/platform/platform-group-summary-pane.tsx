"use client";

import { Building2, Check, Globe, Minus, Users } from "lucide-react";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import { platformSentences, tenantSentences, type SummaryLine } from "@/lib/auth/platform-group-summary";
import { cn } from "@/lib/utils";
import type { GroupMember } from "@/services/user/groups-types";
import type { PlatformGroupTenant } from "@/services/user/platform-groups-types";
import type { ScopeValue } from "./platform-group-scope";

function Lines({ lines }: { lines: SummaryLine[] }) {
    return (
        <ul className="space-y-1.5">
            {lines.map((line) => (
                <li key={line.text} className={cn("flex gap-2 text-sm", !line.can && "text-muted-foreground")}>
                    {line.can ? <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
                    <span className="min-w-0">{line.text}</span>
                </li>
            ))}
        </ul>
    );
}

interface SummaryPaneProps {
    name: string;
    platform: ReadonlySet<string>;
    tenant: ReadonlySet<string>;
    scope: ScopeValue;
    tenants: readonly PlatformGroupTenant[];
    members: GroupMember[];
    /** Platform admin, which says it in its own words. */
    builtIn: boolean;
}

/**
 * What a member of the group can do, as the editor changes it: on the platform, in the tenants of
 * its scope, that it adds up with their own group there, and who is in it.
 */
export function SummaryPane({ name, platform, tenant, scope, tenants, members, builtIn }: SummaryPaneProps) {
    const picked = tenants.filter((entry) => scope.tenantIds.includes(entry.id));
    const where = scope.allTenants ? "In every tenant" : `In ${picked.length} ${picked.length === 1 ? "tenant" : "tenants"}`;
    const whereNote = scope.allTenants ? `${tenants.length} today, new ones too` : picked.map((entry) => entry.name).join(", ");
    const platformLines: SummaryLine[] = builtIn
        ? [
              { text: "Creates, renames and deletes tenants", can: true },
              { text: "Gives every platform group, this one too", can: true },
              { text: "Changes the settings and the sign-in of the instance", can: true },
              { text: "Shares databases, destinations and channels with tenants", can: true },
          ]
        : platformSentences(platform);
    const tenantLines: SummaryLine[] = builtIn
        ? [{ text: "Everything, without being a member", can: true }, { text: "New tenants from the first minute", can: true }]
        : tenantSentences([...tenant]);

    return (
        <div className="space-y-5 p-5">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                What {builtIn ? "a platform admin" : `a member of ${name.trim() || "this group"}`} can do
            </h3>

            <section className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
                    On the platform
                </h4>
                <Lines lines={platformLines} />
            </section>

            <section className="space-y-2 border-t pt-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="shrink-0">{where}</span>
                    {whereNote && <span className="ml-auto min-w-0 truncate text-xs font-normal text-muted-foreground" title={whereNote}>{whereNote}</span>}
                </h4>
                <Lines lines={tenantLines} />
            </section>

            {!builtIn && tenant.size > 0 && (
                <section className="space-y-1 border-t pt-4">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                        <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                        Plus their own group
                    </h4>
                    <p className="text-xs text-muted-foreground">Where a member also has a group in a tenant, both add up. It never takes away what a group of a tenant gives.</p>
                </section>
            )}

            <section className="space-y-2 border-t pt-4">
                <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Members {members.length > 0 && members.length}</h4>
                {members.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nobody yet. Give it to people under Users, one platform group each.</p>
                ) : (
                    <ul className="space-y-2">
                        {members.map((member) => (
                            <li key={member.id} className="flex min-w-0 items-center gap-2.5">
                                <UserAvatar user={member} size="sm" />
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{member.name}</span>
                                    <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {builtIn && <p className="text-xs text-muted-foreground">Given under Users, in the panel of an account, by a platform admin.</p>}
            </section>
        </div>
    );
}
