"use client";

import { KeyRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PickList, type PickEntry } from "@/components/ui/pick-list";
import type { CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import type { CredentialType } from "@/lib/core/credentials";
import { nounOf } from "@/lib/utils";

/** The kind of connection a login is picked for. */
export interface PickerAdapter {
    id: string;
    name: string;
}

interface LoginListProps {
    profiles: CredentialProfileSummary[];
    value: string | null | undefined;
    requiredType: CredentialType;
    adapter?: PickerAdapter;
    /** The label of the field, like "Login" or "SSH login", which names the button that creates one. */
    noun: string;
    /** The connection cannot work without one, so the list offers no way to clear it. */
    required: boolean;
    onPick: (id: string | null) => void;
    /** Both left out for a viewer who may not write logins. */
    onEdit?: (profile: CredentialProfileSummary) => void;
    onCreate?: () => void;
}

const byName = (a: CredentialProfileSummary, b: CredentialProfileSummary) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function connections(count: number): string {
    return count === 1 ? "Used by 1 connection" : `Used by ${count} connections`;
}

/**
 * Where a login is in use. Among the suggestions the kind goes without saying and the count is
 * shown, everywhere else the kind, so a login made for another system is not picked by mistake.
 */
function usage(profile: CredentialProfileSummary, byKind: boolean): string {
    const count = profile.usageCount ?? 0;
    if (count === 0) return "Not used yet";
    if (!byKind || !profile.usedBy?.length) return connections(count);
    return `Used by ${profile.usedBy.map((id) => getAdapterDefinition(id)?.name ?? id).join(", ")}`;
}

function entryOf(profile: CredentialProfileSummary, byKind: boolean): PickEntry {
    return {
        id: profile.id,
        name: profile.name,
        meta: [profile.description, usage(profile, byKind)].filter(Boolean).join(" · "),
        keywords: profile.description ? [profile.description] : undefined,
    };
}

/**
 * The list of saved logins behind the login field. The logins that other connections of the same
 * kind use come first, since the next one most likely wants one of them. Every row says what the
 * login is and where it is in use, so two with similar names are told apart without opening the Vault.
 */
export function LoginList({ profiles, value, requiredType, adapter, noun, required, onPick, onEdit, onCreate }: LoginListProps) {
    const suggested = adapter ? profiles.filter((profile) => profile.usedBy?.includes(adapter.id)).sort(byName) : [];
    const others = profiles.filter((profile) => !suggested.includes(profile)).sort(byName);

    return (
        <PickList
            icon={KeyRound}
            title="Pick from the Vault"
            note={CREDENTIAL_TYPE_INFO[requiredType].hint}
            groups={[
                { heading: adapter && `Used by your ${adapter.name} connections`, entries: suggested.map((profile) => entryOf(profile, false)) },
                { heading: suggested.length > 0 ? "Others" : undefined, entries: others.map((profile) => entryOf(profile, true)) },
            ]}
            value={value}
            emptyText={profiles.length === 0 ? "Nothing of this kind is saved yet." : "Nothing matches."}
            onPick={onPick}
            onEdit={
                onEdit &&
                ((id) => {
                    const profile = profiles.find((entry) => entry.id === id);
                    if (profile) onEdit(profile);
                })
            }
            createLabel={`New ${nounOf(noun)}`}
            onCreate={onCreate}
            aside={
                required ? (
                    <span className="truncate text-xs text-muted-foreground">Required for {adapter?.name ?? "this connection"}</span>
                ) : (
                    value && (
                        <Button type="button" variant="outline" size="sm" onClick={() => onPick(null)}>
                            <X />
                            Use none
                        </Button>
                    )
                )
            }
        />
    );
}
