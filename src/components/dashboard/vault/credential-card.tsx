"use client";

import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import { isPlainClick } from "@/components/ui/row-click";
import type { VaultCredential } from "@/services/vault/vault-types";
import { HoldsCell } from "./credential-columns";
import { ConnectionStack, TypeTile } from "./vault-cells";

interface CredentialCardProps {
    profile: VaultCredential;
    onOpen: (profile: VaultCredential) => void;
    actions: React.ReactNode;
}

/** A credential profile on a phone: what it is, who logs in with it and what it holds. */
export function CredentialCard({ profile, onOpen, actions }: CredentialCardProps) {
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(profile)}
            className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <TypeTile type={profile.type} size="lg" />
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(profile)}
                        className="block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        {profile.name}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">{CREDENTIAL_TYPE_INFO[profile.type].title}</p>
                </div>
                <div className="-mt-1 -mr-2">{actions}</div>
            </div>
            {profile.description && <p className="truncate text-sm text-muted-foreground">{profile.description}</p>}
            <ConnectionStack connections={profile.usedBy} />
            <div className="flex items-center gap-3 border-t pt-3">
                <HoldsCell profile={profile} />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    changed <RelativeTime date={profile.updatedAt} />
                </span>
            </div>
        </div>
    );
}
