"use client";

import Link from "next/link";
import { ArrowUpRight, Bell, CalendarClock, FileText, Filter, Lock, Star, Timer, type LucideIcon } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { JobIcon, JobTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RetentionUse, TemplateJob } from "@/services/templates/templates-types";
import { namesOf } from "./template-format";

export type TemplateKind = "retention" | "naming" | "schedule" | "notification" | "exclude";

export const KIND_ICONS: Record<TemplateKind, LucideIcon> = {
    retention: Timer,
    naming: FileText,
    schedule: CalendarClock,
    notification: Bell,
    exclude: Filter,
};

const TILE = "flex shrink-0 items-center justify-center rounded-lg border bg-muted/50";
const SIZES = { sm: ["size-7", "size-3.5"], md: ["size-8", "size-4"], lg: ["size-10", "size-5"] } as const;

/** The kind of a template as a tile, the icon its dialogs use. */
export function KindTile({ kind, size = "md" }: { kind: TemplateKind; size?: keyof typeof SIZES }) {
    const Icon = KIND_ICONS[kind];
    const [box, icon] = SIZES[size];
    return (
        <span className={cn(TILE, box)} aria-hidden="true">
            <Icon className={icon} />
        </span>
    );
}

/** The mark of a default: a filled star in the color of the text, since a default is no status. */
export function DefaultBadge({ label = "Default" }: { label?: string }) {
    return (
        <Badge variant="outline" className="gap-1 font-medium">
            <Star className="size-3 fill-current" aria-hidden="true" />
            {label}
        </Badge>
    );
}

export function BuiltInBadge() {
    return (
        <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Built in
        </Badge>
    );
}

/** The first logo lies on top of the next. */
const LAYERS = ["z-30", "z-20", "z-10"];

interface StackEntry {
    key: string;
    logo: React.ReactNode;
    name: string;
}

/** The first logos overlapping, then the first two names and how many more. */
export function UsageStack({ entries, empty, className }: { entries: StackEntry[]; empty: string; className?: string }) {
    if (entries.length === 0) return <span className="text-sm text-muted-foreground">{empty}</span>;
    const { text, more } = namesOf(entries.map((entry) => entry.name));
    return (
        <span className={cn("flex min-w-0 items-center gap-2", className)}>
            <span className="flex shrink-0" aria-hidden="true">
                {entries.slice(0, 3).map((entry, index) => (
                    <span
                        key={entry.key}
                        className={cn("relative flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted", LAYERS[index], index > 0 && "-ml-2")}
                    >
                        {entry.logo}
                    </span>
                ))}
            </span>
            <span className="min-w-0 truncate text-sm" title={entries.map((entry) => entry.name).join(", ")}>
                {text}
                {more > 0 && <span className="text-muted-foreground"> +{more}</span>}
            </span>
        </span>
    );
}

const asJob = (job: TemplateJob) => ({ kind: "job" as const, sourceType: job.sourceType, hasFolders: job.hasFolders });

/** The jobs that use a template. */
export function JobsStack({ jobs, empty = "no job", className }: { jobs: TemplateJob[]; empty?: string; className?: string }) {
    return (
        <UsageStack
            className={className}
            empty={empty}
            entries={jobs.map((job) => ({ key: job.id, logo: <JobIcon job={asJob(job)} className="size-3" />, name: job.name }))}
        />
    );
}

/** The destinations a retention policy reaches, each connection once. */
export function DestinationStack({ uses, className }: { uses: RetentionUse[]; className?: string }) {
    const seen = new Map(uses.map((use) => [use.destinationId, use]));
    return (
        <UsageStack
            className={className}
            empty="no destination"
            entries={[...seen.values()].map((use) => ({
                key: use.destinationId,
                logo: <AdapterIcon adapterId={use.adapterId} className="size-3" />,
                name: use.destinationName,
            }))}
        />
    );
}

interface NameCellProps {
    kind: TemplateKind;
    name: string;
    sub: string;
    badges?: React.ReactNode;
    compact?: boolean;
    onOpen: () => void;
}

/** Tile, name and one line about the template. The button in it opens the details for keyboards. */
export function NameCell({ kind, name, sub, badges, compact = false, onOpen }: NameCellProps) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <KindTile kind={kind} size={compact ? "sm" : "md"} />
            <div className={cn("min-w-0 max-w-80", compact && "flex items-baseline gap-2")}>
                {/* On one line the name keeps its room and the line about it gives way first. */}
                <div className={cn("flex min-w-0 items-center gap-2", compact && "max-w-full shrink-0")}>
                    <button
                        type="button"
                        onClick={onOpen}
                        title={name}
                        className="block min-w-0 truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        {name}
                    </button>
                    {badges}
                </div>
                <div className="min-w-0 truncate text-xs text-muted-foreground">{sub}</div>
            </div>
        </div>
    );
}

export interface UseEntry {
    key: string;
    href: string;
    tile: React.ReactNode;
    name: string;
    detail: string;
    aside?: React.ReactNode;
}

/** The jobs, destinations or folders that use a template, each opening where it is kept. */
export function UseList({ entries, more }: { entries: UseEntry[]; more?: string }) {
    return (
        <ul className="divide-y rounded-lg border">
            {entries.map((entry) => (
                <li key={entry.key} className="relative flex items-center gap-3 px-3 py-2 hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50">
                    {entry.tile}
                    <div className="min-w-0 flex-1">
                        <Link href={entry.href} className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 hover:underline hover:underline-offset-4">
                            {entry.name}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">{entry.detail}</span>
                    </div>
                    {entry.aside && <span className="relative shrink-0">{entry.aside}</span>}
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </li>
            ))}
            {more && <li className="px-3 py-2 text-xs text-muted-foreground">{more}</li>}
        </ul>
    );
}

/** A job as the tile of a row. */
export function JobRowTile({ job }: { job: TemplateJob | undefined }) {
    return <JobTile job={job ? asJob(job) : { kind: "none", sourceType: null, hasFolders: false }} size="sm" />;
}

/** A connection as the tile of a row. */
export function ConnectionRowTile({ adapterId }: { adapterId: string }) {
    return (
        <span className={cn(TILE, "size-7")} aria-hidden="true">
            <AdapterIcon adapterId={adapterId} className="size-3.5" />
        </span>
    );
}
