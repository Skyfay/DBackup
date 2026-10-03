"use client";

import { AlertTriangle } from "lucide-react";
import { countWord } from "@/components/dashboard/groups/group-cells";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { ProviderTile } from "@/components/oidc/provider-logo";
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

/** What happens to someone new: added to a group, added without one in amber, or not added. */
export function NewPeopleCell({ provider }: { provider: Pick<SsoProviderRow, "allowProvisioning" | "group"> }) {
    if (!provider.allowProvisioning) return <span className="text-sm text-muted-foreground">Not added</span>;
    if (!provider.group) {
        return (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-warning" title="They sign in, but see and do nothing until someone picks a group">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Added without a group</span>
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

/** On in green, off in gray. */
export function ProviderStateBadge({ provider }: { provider: Pick<SsoProviderRow, "enabled"> }) {
    return provider.enabled ? (
        <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Enabled</Badge>
    ) : (
        <Badge variant="secondary" className="text-muted-foreground">Disabled</Badge>
    );
}
