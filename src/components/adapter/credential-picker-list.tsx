"use client";

import { Check, KeyRound, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import type { CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import type { CredentialType } from "@/lib/core/credentials";
import { cn } from "@/lib/utils";

/** What a profile of each type holds, shown beside the label and in the head of the list. */
export const TYPE_HINT: Record<CredentialType, string> = {
    USERNAME_PASSWORD: "User and password",
    SSH_KEY: "Key or password",
    ACCESS_KEY: "Key ID and secret",
    TOKEN: "API token",
    SMTP: "SMTP user and password",
    WEBHOOK: "URL and auth header",
    OAUTH: "Client ID and secret",
};

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
    /** The connection cannot work without one, so the list offers no way to clear it. */
    required: boolean;
    onPick: (id: string | null) => void;
    onEdit: (profile: CredentialProfileSummary) => void;
    onCreate: () => void;
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

function LoginRow({ profile, picked, byKind, onPick, onEdit }: {
    profile: CredentialProfileSummary;
    picked: boolean;
    byKind: boolean;
    onPick: (id: string) => void;
    onEdit: (profile: CredentialProfileSummary) => void;
}) {
    const meta = [profile.description, usage(profile, byKind)].filter(Boolean).join(" · ");
    return (
        <CommandItem value={profile.name} keywords={profile.description ? [profile.description] : undefined} onSelect={() => onPick(profile.id)} className="group gap-3 px-2 py-2">
            <span
                className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border", picked ? "border-tone/30 bg-tone/12" : "bg-muted")}
                aria-hidden="true"
            >
                <KeyRound className={cn("size-3.5", picked ? "text-tone" : "text-muted-foreground")} />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{profile.name}</span>
                <span className="truncate text-xs text-muted-foreground">{meta}</span>
            </span>
            {picked && (
                <>
                    <Check className="size-4 text-tone" aria-hidden="true" />
                    <span className="sr-only">Picked</span>
                </>
            )}
            {/* Shown on hover from md up, always on a phone, which has none. The row picks on a
                click and on Enter, so the button keeps both to itself. */}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-xs md:opacity-0 md:group-hover:opacity-100 md:group-data-[selected=true]:opacity-100 md:focus-visible:opacity-100"
                onClick={(event) => {
                    event.stopPropagation();
                    onEdit(profile);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                aria-label={`Edit ${profile.name}`}
            >
                <Pencil className="size-3" />
                Edit
            </Button>
        </CommandItem>
    );
}

/**
 * The list of saved logins behind the login field, headed in the turquoise of picking. The logins
 * that other connections of the same kind use come first, since the next one most likely wants
 * one of them. Every row says what the login is and where it is in use, so two with similar
 * names are told apart without opening the Vault.
 */
export function LoginList({ profiles, value, requiredType, adapter, required, onPick, onEdit, onCreate }: LoginListProps) {
    const suggested = adapter ? profiles.filter((profile) => profile.usedBy?.includes(adapter.id)).sort(byName) : [];
    const others = profiles.filter((profile) => !suggested.includes(profile)).sort(byName);
    const row = (profile: CredentialProfileSummary, byKind: boolean) => (
        <LoginRow key={profile.id} profile={profile} picked={profile.id === value} byKind={byKind} onPick={onPick} onEdit={onEdit} />
    );

    return (
        <>
            <DialogHead tone="pick" icon={KeyRound} className="px-3.5 py-3">
                <p className="text-sm font-semibold">Pick from the Vault</p>
                <p className={dialogNoteClass("pick")}>{TYPE_HINT[requiredType]}</p>
            </DialogHead>
            <Command>
                <CommandInput placeholder="Search by name or description" />
                <CommandList>
                    <CommandEmpty className="grid justify-items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
                        {profiles.length === 0 ? "Nothing of this kind is saved yet." : "Nothing matches."}
                        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
                            <Plus />
                            New
                        </Button>
                    </CommandEmpty>
                    {suggested.length > 0 && adapter && (
                        <CommandGroup heading={`Used by your ${adapter.name} connections`}>{suggested.map((profile) => row(profile, false))}</CommandGroup>
                    )}
                    {others.length > 0 && (
                        <CommandGroup heading={suggested.length > 0 ? "Others" : undefined}>{others.map((profile) => row(profile, true))}</CommandGroup>
                    )}
                </CommandList>
            </Command>
            {(required || value) && (
                <div className="flex min-h-11 items-center justify-end border-t bg-page/60 px-3 py-1.5">
                    {required ? (
                        <span className="text-xs text-muted-foreground">Required for {adapter?.name ?? "this connection"}</span>
                    ) : (
                        <Button type="button" variant="ghost" size="sm" onClick={() => onPick(null)}>
                            Use none
                        </Button>
                    )}
                </div>
            )}
        </>
    );
}
