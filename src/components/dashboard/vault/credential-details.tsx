"use client";

import Link from "next/link";
import { ArrowUpRight, Eye, Pencil, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { DetailStats, FactList, Section } from "@/components/adapter/connection-details-sections";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import { SshPublicKeyPanel } from "@/components/settings/ssh-public-key-panel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { VaultActor, VaultConnection, VaultCredential } from "@/services/vault/vault-types";
import { TypeTile } from "./vault-cells";
import { connectionHref, connectionKind, count } from "./vault-format";

const STATUS: Record<NonNullable<VaultConnection["status"]> | "NONE", { label: string; dot: string }> = {
    ONLINE: { label: "Online", dot: "bg-success" },
    DEGRADED: { label: "Degraded", dot: "bg-warning" },
    OFFLINE: { label: "Offline", dot: "bg-destructive" },
    NONE: { label: "Not checked", dot: "bg-muted-foreground/40" },
};

/** "14 Mar 2026 by Manu", or the date alone when the audit log no longer says who. */
export function ActorText({ date, actor }: { date: string; actor: VaultActor | null }) {
    return (
        <>
            <DateDisplay date={date} format="P" />
            {actor?.by && ` by ${actor.by}`}
        </>
    );
}

/** The connections that log in with a profile, each opening on the Connections page. */
function UsedByList({ connections }: { connections: VaultConnection[] }) {
    if (connections.length === 0) {
        return <p className="text-sm text-muted-foreground">No connection logs in with it, so deleting it breaks nothing.</p>;
    }
    return (
        <ul className="divide-y rounded-lg border">
            {connections.map((connection) => {
                const status = STATUS[connection.status ?? "NONE"];
                return (
                    <li key={`${connection.id}-${connection.slot}`} className="relative flex items-center gap-3 px-3 py-2 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                            <AdapterIcon adapterId={connection.adapterId} className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <Link href={connectionHref(connection)} className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 hover:underline hover:underline-offset-4">
                                {connection.name}
                            </Link>
                            <span className="block truncate text-xs text-muted-foreground">{connectionKind(connection)}</span>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <span className={cn("size-1.5 rounded-full", status.dot)} aria-hidden="true" />
                            {status.label}
                        </span>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </li>
                );
            })}
        </ul>
    );
}

interface CredentialDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    profile: VaultCredential | null;
    auditDays: number;
    onClose: () => void;
    onEdit?: (profile: VaultCredential) => void;
    onReveal?: (profile: VaultCredential) => void;
    /** The rest of what the profile can do, as the menu of its row shows it. */
    groups: BackupActionGroup[];
}

/** Everything about one credential profile in a panel from the right: who logs in with it, its public key and its history. */
export function CredentialDetails({ open, profile, auditDays, onClose, onEdit, onReveal, groups }: CredentialDetailsProps) {
    return (
        <Sheet open={open && profile !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {profile && <Content profile={profile} auditDays={auditDays} onEdit={onEdit} onReveal={onReveal} groups={groups} />}
            </SheetContent>
        </Sheet>
    );
}

function Content({ profile, auditDays, onEdit, onReveal, groups }: Omit<CredentialDetailsProps, "open" | "profile" | "onClose"> & { profile: VaultCredential }) {
    const info = CREDENTIAL_TYPE_INFO[profile.type];
    const notLately = `not in the last ${auditDays} days`;
    const facts = [
        { label: "Holds", value: profile.holds },
        { label: "Created", value: <ActorText date={profile.createdAt} actor={profile.created} /> },
        { label: "Changed", value: <ActorText date={profile.updatedAt} actor={profile.changed} /> },
        {
            label: "Revealed",
            value: profile.revealed
                ? <><RelativeTime date={profile.revealed.at} />{profile.revealed.by && ` by ${profile.revealed.by}`}</>
                : notLately,
        },
    ];

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <TypeTile type={profile.type} size="lg" />
                    <div className="min-w-0">
                        <SheetTitle className="truncate text-lg font-semibold">{profile.name}</SheetTitle>
                        <SheetDescription className="truncate text-sm text-muted-foreground">
                            {info.title}
                            {profile.description && ` · ${profile.description}`}
                        </SheetDescription>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {onEdit && (
                        <Button variant="outline" size="sm" onClick={() => onEdit(profile)}>
                            <Pencil />
                            Edit
                        </Button>
                    )}
                    {onReveal && (
                        <Button variant="outline" size="sm" onClick={() => onReveal(profile)}>
                            <Eye />
                            Reveal secret
                        </Button>
                    )}
                    <BackupRowMenu name={profile.name} groups={groups} variant="outline" align="start" />
                </div>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    {profile.attention && (
                        <div className="relative flex gap-3 overflow-hidden rounded-lg border border-warning/30 bg-warning/5 p-3 pl-4">
                            <span className="absolute inset-y-0 left-0 w-1 bg-warning" aria-hidden="true" />
                            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                            <div className="min-w-0 space-y-1 text-sm">
                                <p className="font-medium">{profile.holds[0].toUpperCase() + profile.holds.slice(1)}</p>
                                <p className="text-muted-foreground">{profile.attention}</p>
                            </div>
                        </div>
                    )}

                    <DetailStats
                        stats={[
                            { label: "Type", value: info.title, extra: info.hint },
                            { label: "Used by", value: profile.usedBy.length, extra: profile.usedBy.length === 1 ? "connection" : "connections" },
                            { label: "Changed", value: <RelativeTime date={profile.updatedAt} />, extra: profile.changed?.by ? `by ${profile.changed.by}` : " " },
                            { label: "Revealed", value: profile.reveals, extra: `in the last ${auditDays} days` },
                        ]}
                    />

                    <Section title={profile.usedBy.length > 0 ? `Used by ${count(profile.usedBy.length, "connection")}` : "Used by"}>
                        <UsedByList connections={profile.usedBy} />
                    </Section>

                    {profile.publicKey && (
                        <Section title="Public key">
                            <SshPublicKeyPanel publicKey={profile.publicKey} fingerprint={profile.fingerprint} fileName={profile.name} />
                        </Section>
                    )}

                    <Section title="History" aside={`the audit log keeps ${auditDays} days`}>
                        <FactList facts={facts} />
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}
