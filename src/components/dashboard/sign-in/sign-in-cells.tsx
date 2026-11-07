"use client";

import { AlertTriangle, Globe, LogIn, Mail } from "lucide-react";
import { countWord } from "@/components/dashboard/groups/group-cells";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { ProviderTile } from "@/components/oidc/provider-logo";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Badge } from "@/components/ui/badge";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { SsoPerson, SsoProviderRow } from "@/services/sso/sso-providers-types";

/** A provider that is off has its name in gray like a paused job. */
export const quietName = (provider: Pick<SsoProviderRow, "enabled">) => !provider.enabled && "text-muted-foreground";

/** "auth.example.ch, realm test", where people sign in. */
export const placeLine = (provider: Pick<SsoProviderRow, "host" | "hostDetail">) => [provider.host, provider.hostDetail].filter(Boolean).join(", ") || "-";

/** The people linked through it who have no other way in. */
export const onlyWayIn = (provider: Pick<SsoProviderRow, "linked">) => provider.linked.filter((person) => person.otherWays.length === 0);

/** Logo, name and provider ID. The name is a button, the way in for keyboards. */
export function ProviderCell({ provider, compact, onOpen }: { provider: SsoProviderRow; compact: boolean; onOpen: (provider: SsoProviderRow) => void }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <ProviderTile adapterId={provider.adapterId} size={compact ? "sm" : "md"} />
            <div className={cn("min-w-0 max-w-64", compact && "flex items-baseline gap-2")}>
                <button
                    type="button"
                    onClick={() => onOpen(provider)}
                    title={provider.name}
                    className={cn(
                        "block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                        quietName(provider)
                    )}
                >
                    {provider.name}
                </button>
                <span className="block truncate font-mono text-xs text-muted-foreground">{provider.providerId}</span>
            </div>
        </div>
    );
}

export function PlaceCell({ provider }: { provider: SsoProviderRow }) {
    return (
        <div className="min-w-0 text-sm">
            <div className="truncate" title={provider.host ?? undefined}>{provider.host ?? "-"}</div>
            {provider.hostDetail && <div className="truncate text-xs text-muted-foreground">{provider.hostDetail}</div>}
        </div>
    );
}

/** The first people linked through it as faces on top of each other, then how many. */
export function LinkedFaces({ people, max = 3, empty = "nobody", className }: { people: SsoPerson[]; max?: number; empty?: string; className?: string }) {
    if (people.length === 0) return <span className={cn("text-sm text-muted-foreground", className)}>{empty}</span>;
    return (
        <span className={cn("flex min-w-0 items-center gap-2", className)} title={people.map((person) => person.name).join(", ")}>
            <span className="flex shrink-0" aria-hidden="true">
                {people.slice(0, max).map((person, index) => (
                    <span key={person.id} className={cn("rounded-full ring-2 ring-card", index > 0 && "-ml-1.5")}>
                        <UserAvatar user={person} size="sm" />
                    </span>
                ))}
            </span>
            <span className="truncate text-sm whitespace-nowrap">{countWord(people.length, "person", "people")}</span>
        </span>
    );
}

/** When someone last signed in through it and who, or when it was made. */
export function LastSignInCell({ provider }: { provider: SsoProviderRow }) {
    if (!provider.lastSignIn) {
        return (
            <div className="min-w-0 text-sm">
                <div className="text-muted-foreground">never</div>
                <div className="truncate text-xs text-muted-foreground">
                    made <DateDisplay date={provider.createdAt} format="P" />
                </div>
            </div>
        );
    }
    return (
        <div className="min-w-0 text-sm">
            <RelativeTime date={provider.lastSignIn.at} className="whitespace-nowrap" />
            <div className="truncate text-xs text-muted-foreground">{provider.lastSignIn.name}</div>
        </div>
    );
}

/** A group as a tag, like in the list of users. */
function GroupName({ name }: { name: string }) {
    return <span className="inline-flex h-5.5 max-w-40 items-center truncate rounded-md border px-2 text-xs font-medium" title={name}>{name}</span>;
}

/**
 * What happens to someone new: added to a group, added without one in amber, or not added. With
 * more than one tenant it names the tenant they land in, like Acme GmbH as Viewer.
 */
export function NewPeopleCell({ provider, withTenant = false }: { provider: Pick<SsoProviderRow, "allowProvisioning" | "group" | "landsIn">; withTenant?: boolean }) {
    if (!provider.allowProvisioning) return <span className="text-sm text-muted-foreground">{withTenant ? "Not added, an account first" : "Not added"}</span>;
    if (!provider.group) {
        return (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-warning" title="They sign in, but see and do nothing until someone picks a group">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{withTenant ? `Added to ${provider.landsIn.name} without a group` : "Added without a group"}</span>
            </span>
        );
    }
    if (withTenant) {
        return (
            <span className="flex min-w-0 items-center gap-2 text-sm">
                <span className="min-w-0 truncate" title={provider.landsIn.name}>{provider.landsIn.name}</span>
                <span className="shrink-0 text-muted-foreground">as</span>
                <GroupName name={provider.group.name} />
            </span>
        );
    }
    return (
        <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0">Added to</span>
            <GroupName name={provider.group.name} />
        </span>
    );
}

/** The platform, or the tenant that brings a provider, as a small tag with its mark. */
export function BelongsTo({ tenant, className }: { tenant: SsoProviderRow["tenant"]; className?: string }) {
    if (!tenant) {
        return (
            <span className={cn("inline-flex h-6 max-w-48 items-center gap-1.5 rounded-md border bg-muted/50 px-2 text-xs font-medium", className)}>
                <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                Platform
            </span>
        );
    }
    return (
        <span className={cn("inline-flex h-6 max-w-48 min-w-0 items-center gap-1.5 rounded-md border bg-muted/50 pr-2 pl-0.5 text-xs font-medium", className)} title={tenant.name}>
            <TenantTileMark name={tenant.name} className="size-5 rounded-sm border-0 bg-background text-[9px]" />
            <span className="truncate">{tenant.name}</span>
        </span>
    );
}

/** The email domain that reaches a provider, in mono like an ID. */
export function DomainCell({ domain }: { domain: string | null }) {
    return domain
        ? <span className="block max-w-44 truncate font-mono text-xs" title={domain}>{domain}</span>
        : <span className="text-sm text-muted-foreground">-</span>;
}

/** How the login page reaches a provider: a button for one of the platform, the email for one of a tenant. */
export function LoginPageCell({ provider }: { provider: Pick<SsoProviderRow, "tenant"> }) {
    if (provider.tenant) {
        return (
            <span className="flex items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground">
                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                By the email
            </span>
        );
    }
    return (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap">
            <LogIn className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            Button
        </span>
    );
}

/** On in green, off in gray. */
export function ProviderStateBadge({ provider }: { provider: Pick<SsoProviderRow, "enabled"> }) {
    return provider.enabled ? (
        <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Enabled</Badge>
    ) : (
        <Badge variant="secondary" className="text-muted-foreground">Disabled</Badge>
    );
}
