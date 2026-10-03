"use client";

import { KeyRound } from "lucide-react";
import { UserAvatar, YouTag } from "@/components/dashboard/users/user-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Badge } from "@/components/ui/badge";
import { DateDisplay } from "@/components/utils/date-display";
import { accessLine, summarizeAccess } from "@/lib/auth/access-summary";
import { cn } from "@/lib/utils";
import { runsOutSoon, type ApiKeyRow } from "@/services/auth/api-keys-types";

const TILE_SIZES = { sm: ["size-7", "size-3.5"], md: ["size-8", "size-4"], lg: ["size-11", "size-5"] } as const;

export function KeyTile({ size = "md" }: { size?: keyof typeof TILE_SIZES }) {
    const [box, icon] = TILE_SIZES[size];
    return (
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg border bg-muted/50", box)} aria-hidden="true">
            <KeyRound className={icon} />
        </span>
    );
}

/** What a key may do right now in one line, like "Runs jobs, reads their history". */
export const keyLine = (key: Pick<ApiKeyRow, "effective">) => (key.effective.length === 0 ? "Nothing right now" : accessLine(summarizeAccess(key.effective)));

/** "dbackup_4f1a9c0e...", in mono since it is part of a secret. */
export function PrefixText({ prefix, className }: { prefix: string; className?: string }) {
    return <span className={cn("font-mono text-xs", className)}>{prefix}...</span>;
}

/** A key that does not work, disabled or expired, has its name in gray like a paused job. */
export const quietName = (key: Pick<ApiKeyRow, "state">) => key.state !== "enabled" && "text-muted-foreground";

/** Tile, name and prefix. The name is a button, the way in for keyboards. */
export function KeyCell({ apiKey, compact, onOpen }: { apiKey: ApiKeyRow; compact: boolean; onOpen: (key: ApiKeyRow) => void }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <KeyTile size={compact ? "sm" : "md"} />
            <div className={cn("min-w-0 max-w-64", compact && "flex items-baseline gap-2")}>
                <button
                    type="button"
                    onClick={() => onOpen(apiKey)}
                    title={apiKey.name}
                    className={cn(
                        "block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                        quietName(apiKey)
                    )}
                >
                    {apiKey.name}
                </button>
                <PrefixText prefix={apiKey.prefix} className="block truncate text-muted-foreground" />
            </div>
        </div>
    );
}

export function OwnerCell({ apiKey }: { apiKey: ApiKeyRow }) {
    return (
        <span className="flex min-w-0 items-center gap-2 text-sm" title={apiKey.owner.groupName ? `${apiKey.owner.name}, ${apiKey.owner.groupName}` : apiKey.owner.name}>
            <UserAvatar user={apiKey.owner} size="sm" />
            <span className="truncate">{apiKey.owner.name}</span>
            {apiKey.isMine && <YouTag />}
        </span>
    );
}

/** Enabled in green, running out soon in amber, expired in red, disabled in gray. */
export function StateBadge({ apiKey, now }: { apiKey: ApiKeyRow; now: number }) {
    if (apiKey.state === "expired") return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive-text">Expired</Badge>;
    if (apiKey.state === "disabled") return <Badge variant="secondary" className="text-muted-foreground">Disabled</Badge>;
    if (apiKey.expiresAt && runsOutSoon(apiKey, now)) {
        return (
            <Badge variant="outline" className="border-warning/30 bg-warning/10 whitespace-nowrap text-warning">
                Runs out <RelativeTime date={apiKey.expiresAt} />
            </Badge>
        );
    }
    return <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Enabled</Badge>;
}

/** When the key was last used, with the job it last started. */
export function LastUsedCell({ apiKey }: { apiKey: ApiKeyRow }) {
    if (!apiKey.lastUsedAt) {
        return (
            <div className="min-w-0 text-sm">
                <div className="text-muted-foreground">never</div>
                <div className="truncate text-xs text-muted-foreground">
                    made <DateDisplay date={apiKey.createdAt} format="P" />
                </div>
            </div>
        );
    }
    return (
        <div className="min-w-0 text-sm">
            <RelativeTime date={apiKey.lastUsedAt} className="whitespace-nowrap" />
            {apiKey.lastRun?.job && <div className="truncate text-xs text-muted-foreground">started {apiKey.lastRun.job}</div>}
        </div>
    );
}

/** When the key runs out, or ran out. */
export function ExpiryCell({ apiKey }: { apiKey: ApiKeyRow }) {
    if (!apiKey.expiresAt) return <span className="text-sm text-muted-foreground">never</span>;
    return (
        <div className="min-w-0 text-sm">
            <RelativeTime date={apiKey.expiresAt} className="whitespace-nowrap" />
            <div className="truncate text-xs text-muted-foreground">
                <DateDisplay date={apiKey.expiresAt} format="P" />
            </div>
        </div>
    );
}
