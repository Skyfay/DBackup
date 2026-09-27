"use client";

import { CircleCheck, LockKeyhole, Settings2, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { JobIcon } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import type { CredentialType } from "@/lib/core/credentials";
import { cn } from "@/lib/utils";
import type { VaultConnection, VaultKeyDestination, VaultKeyJob, VaultKit } from "@/services/vault/vault-types";
import { namesOf } from "./vault-format";

const TILE = "flex shrink-0 items-center justify-center rounded-lg border bg-muted/50";
const SIZES = { sm: ["size-7", "size-3.5"], md: ["size-8", "size-4"], lg: ["size-10", "size-5"] } as const;

type TileSize = keyof typeof SIZES;

/** The kind of a credential profile as a tile, the icon the dialogs use for it. */
export function TypeTile({ type, size = "md" }: { type: CredentialType; size?: TileSize }) {
    const Icon = CREDENTIAL_TYPE_INFO[type].icon;
    const [box, icon] = SIZES[size];
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            <Icon className={icon} />
        </span>
    );
}

/** An encryption key as a tile. */
export function KeyTile({ size = "md" }: { size?: TileSize }) {
    const [box, icon] = SIZES[size];
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            <LockKeyhole className={icon} />
        </span>
    );
}

/** A Key ID, like "8a2f 91c3". Mono, since it is a hash. */
export function KeyIdText({ keyId, className }: { keyId: string | null; className?: string }) {
    if (!keyId) return <span className={cn("text-sm text-muted-foreground", className)}>unreadable</span>;
    return <span className={cn("font-mono text-xs tracking-wide", className)}>{keyId}</span>;
}

/** The first logo lies on top of the next. */
const LAYERS = ["z-30", "z-20", "z-10"];

/** One round logo in a row of them that overlap. */
function Logo({ children, index }: { children: React.ReactNode; index: number }) {
    return (
        <span className={cn("relative flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted", LAYERS[index], index > 0 && "-ml-2")}>
            {children}
        </span>
    );
}

interface StackProps {
    /** A logo and a name per entry. */
    entries: { key: string; logo: React.ReactNode; name: string }[];
    empty: string;
    className?: string;
}

/** The first logos overlapping, then the first two names and how many more. */
function LogoStack({ entries, empty, className }: StackProps) {
    if (entries.length === 0) return <span className="text-sm text-muted-foreground">{empty}</span>;
    const { text, more } = namesOf(entries.map((entry) => entry.name));
    return (
        <span className={cn("flex min-w-0 items-center gap-2", className)}>
            <span className="flex shrink-0" aria-hidden="true">
                {entries.slice(0, 3).map((entry, index) => (
                    <Logo key={entry.key} index={index}>{entry.logo}</Logo>
                ))}
            </span>
            <span className="min-w-0 truncate text-sm" title={entries.map((entry) => entry.name).join(", ")}>
                {text}
                {more > 0 && <span className="text-muted-foreground"> +{more}</span>}
            </span>
        </span>
    );
}

/** The connections that log in with a profile. */
export function ConnectionStack({ connections, className }: { connections: VaultConnection[]; className?: string }) {
    return (
        <LogoStack
            className={className}
            empty="no connection"
            entries={connections.map((connection) => ({
                key: `${connection.id}-${connection.slot}`,
                logo: <AdapterIcon adapterId={connection.adapterId} className="size-3" />,
                name: connection.name,
            }))}
        />
    );
}

/** The jobs, and the config backup, that encrypt with a key. */
export function JobStack({ jobs, configBackup, className }: { jobs: VaultKeyJob[]; configBackup: boolean; className?: string }) {
    const entries = [
        ...jobs.map((job) => ({
            key: job.id,
            logo: <JobIcon job={{ kind: "job", sourceType: job.sourceType, hasFolders: job.hasFolders }} className="size-3" />,
            name: job.name,
        })),
        ...(configBackup ? [{ key: "config", logo: <Settings2 className="size-3 text-muted-foreground" />, name: "Config backup" }] : []),
    ];
    return <LogoStack className={className} entries={entries} empty="no job" />;
}

/** Whether a key was ever in a recovery kit, and when it was last. */
export function KitCell({ kit, withBy = true }: { kit: VaultKit | null; withBy?: boolean }) {
    if (!kit) {
        return (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-warning">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                Never downloaded
            </span>
        );
    }
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
            <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            <RelativeTime date={kit.at} className="whitespace-nowrap" />
            {withBy && kit.by && <span className="truncate text-muted-foreground">by {kit.by}</span>}
        </span>
    );
}

/** The shades of the parts of a share bar, the largest part darkest. Neutral, since a share is no status. */
const SHADES = ["bg-foreground/60", "bg-foreground/35", "bg-foreground/20"];

/** How the backups of a key spread over its destinations, as one bar and a row per destination. */
export function DestinationShare({ destinations, total, rows = true }: { destinations: VaultKeyDestination[]; total: number; rows?: boolean }) {
    if (total === 0) return null;
    return (
        <div className="space-y-2">
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                {destinations.map((destination, index) => (
                    // The width is the share itself, the one value here no class can hold.
                    <span key={destination.id} className={SHADES[Math.min(index, SHADES.length - 1)]} style={{ width: `${(destination.count / total) * 100}%` }} />
                ))}
            </div>
            {rows && (
                <ul className="space-y-1.5">
                    {destinations.map((destination, index) => (
                        <li key={destination.id} className="flex min-w-0 items-center gap-2 text-sm">
                            <span className={cn("size-2 shrink-0 rounded-xs", SHADES[Math.min(index, SHADES.length - 1)])} aria-hidden="true" />
                            <AdapterIcon adapterId={destination.adapterId} className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{destination.name}</span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">{destination.count.toLocaleString()}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
