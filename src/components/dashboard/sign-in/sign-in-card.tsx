"use client";

import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { ProviderTile } from "@/components/oidc/provider-logo";
import { isPlainClick } from "@/components/ui/row-click";
import { cn } from "@/lib/utils";
import type { SsoProviderRow } from "@/services/sso/sso-providers-types";
import { LinkedFaces, NewPeopleCell, placeLine, ProviderStateBadge, quietName } from "./sign-in-cells";

interface SignInCardProps {
    provider: SsoProviderRow;
    onOpen: (provider: SsoProviderRow) => void;
    actions: React.ReactNode;
}

/** A provider as a card: where it signs in, who is linked, and what happens to someone new. */
export function SignInCard({ provider, onOpen, actions }: SignInCardProps) {
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(provider)}
            className="flex min-w-0 cursor-pointer flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <ProviderTile adapterId={provider.adapterId} size="lg" />
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(provider)}
                        className={cn(
                            "block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                            quietName(provider)
                        )}
                    >
                        {provider.name}
                    </button>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{provider.providerId}</span>
                </div>
                <ProviderStateBadge provider={provider} />
                <div className="-mt-1 -mr-2">{actions}</div>
            </div>
            <p className="min-w-0 truncate text-sm text-muted-foreground">
                Signs in at <span className="text-foreground">{placeLine(provider)}</span>
            </p>
            <LinkedFaces people={provider.linked} empty="nobody linked yet" />
            <div className="flex min-w-0 items-center gap-3 border-t pt-3">
                <div className="min-w-0">
                    <NewPeopleCell provider={provider} />
                </div>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {provider.lastSignIn ? <>last sign-in <RelativeTime date={provider.lastSignIn.at} /></> : "never used"}
                </span>
            </div>
        </div>
    );
}
