"use client";

import {
    CircleAlert, Copy, Download, Eye, KeyRound, Link2, Lock, LockOpen, LogIn, LogOut, MapPin, Pencil, Play, Plus, Power, RefreshCw, RotateCcw, Settings,
    Square, Trash, UserX, type LucideIcon,
} from "lucide-react";
import { KeyTile } from "@/components/dashboard/api-keys/api-key-cells";
import { UserAvatar } from "@/components/dashboard/users/user-cells";
import { Badge } from "@/components/ui/badge";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import type { EntryGlyph, EntryKind, SentencePart } from "@/lib/core/audit-sentence";
import { cn } from "@/lib/utils";
import type { AuditActor, AuditRow } from "@/services/audit/audit-types";

export const GLYPHS: Record<EntryGlyph, LucideIcon> = {
    "log-in": LogIn,
    "log-out": LogOut,
    alert: CircleAlert,
    plus: Plus,
    copy: Copy,
    pencil: Pencil,
    trash: Trash,
    play: Play,
    restore: RotateCcw,
    download: Download,
    link: Link2,
    eye: Eye,
    lock: Lock,
    unlock: LockOpen,
    rotate: RefreshCw,
    power: Power,
    stop: Square,
    key: KeyRound,
    settings: Settings,
};

/** Sensitive entries and failed sign-ins carry an amber icon, everything else a quiet one. */
export const marked = (kind: EntryKind) => kind === "sensitive" || kind === "failed";

export function EntryIcon({ glyph, kind, className }: { glyph: EntryGlyph; kind: EntryKind; className?: string }) {
    const Icon = GLYPHS[glyph];
    return <Icon className={cn("size-3.5 shrink-0", marked(kind) ? "text-warning" : "text-muted-foreground", className)} aria-hidden="true" />;
}

/** The sentence of an entry with its names in bold. */
export function Sentence({ parts, className }: { parts: SentencePart[]; className?: string }) {
    return (
        <span className={className}>
            {parts.map((part, index) => (part.strong ? <span key={index} className="font-semibold">{part.text}</span> : <span key={index}>{part.text}</span>))}
        </span>
    );
}

export function NewPlaceBadge() {
    return (
        <Badge variant="outline" className="shrink-0 gap-1 border-warning/30 bg-warning/10 text-warning">
            <MapPin className="size-3" aria-hidden="true" />
            New place
        </Badge>
    );
}

/** The face of who wrote an entry: a person, an API key, or a dashed mark for nobody. */
export function ActorFace({ actor, size = "sm" }: { actor: AuditActor; size?: "sm" | "md" }) {
    if (actor.kind === "key") return <KeyTile size={size} />;
    if (actor.kind === "person") return <UserAvatar user={{ name: actor.name, image: actor.image }} size={size} />;
    return (
        <span
            className={cn("flex shrink-0 items-center justify-center rounded-full border border-dashed border-warning/60", size === "sm" ? "size-7" : "size-8")}
            aria-hidden="true"
        >
            <UserX className="size-3.5 text-warning" />
        </span>
    );
}

export function DeletedTag() {
    return <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">deleted</span>;
}

export function WhoCell({ actor }: { actor: AuditActor }) {
    return (
        <div className="flex min-w-0 max-w-56 items-center gap-2.5">
            <ActorFace actor={actor} />
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{actor.name}</span>
                    {actor.deleted && <DeletedTag />}
                </div>
                {actor.sub && <div className="truncate text-xs text-muted-foreground">{actor.sub}</div>}
            </div>
        </div>
    );
}

/** What happened: the icon, the sentence and what changed in one line under it. */
export function WhatCell({ row }: { row: AuditRow }) {
    const text = row.parts.map((part) => part.text).join("");
    return (
        <div className="min-w-0 max-w-2xl">
            <div className="flex min-w-0 items-center gap-2.5 text-sm">
                <EntryIcon glyph={row.glyph} kind={row.kind} />
                <Sentence parts={row.parts} className={cn("min-w-0 truncate", row.kind === "failed" && "text-warning")} />
                {row.newPlace && <NewPlaceBadge />}
            </div>
            {row.summary && (
                <div className="truncate pl-6 text-xs text-muted-foreground" title={`${text}: ${row.summary}`}>
                    {row.summary}
                </div>
            )}
        </div>
    );
}

/** The time of an entry, and today, yesterday or the date under it, in the time zone of the viewer. */
export function WhenCell({ at, now }: { at: string; now: number }) {
    const { formatDate } = useDateFormatter();
    const day = formatDate(at, "yyyy-MM-dd");
    const today = formatDate(new Date(now), "yyyy-MM-dd");
    const yesterday = formatDate(new Date(now - 86_400_000), "yyyy-MM-dd");
    return (
        <div className="min-w-0 text-sm whitespace-nowrap">
            <div className="tabular-nums">{formatDate(at, "p")}</div>
            <div className="text-xs text-muted-foreground tabular-nums">{day === today ? "today" : day === yesterday ? "yesterday" : formatDate(at, "P")}</div>
        </div>
    );
}

export function FromCell({ row }: { row: AuditRow }) {
    if (!row.device && !row.ipAddress) return <span className="text-sm text-muted-foreground">-</span>;
    return (
        <div className="min-w-0 max-w-48 text-sm">
            <div className="truncate">{row.device ?? "-"}</div>
            {row.ipAddress && <div className="truncate text-xs text-muted-foreground tabular-nums">{row.ipAddress}</div>}
        </div>
    );
}
