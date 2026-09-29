"use client";

import { LevelStrip } from "@/components/dashboard/groups/group-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { isPlainClick } from "@/components/ui/row-click";
import { cn } from "@/lib/utils";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";
import { keyLine, KeyTile, OwnerCell, PrefixText, quietName, StateBadge } from "./api-key-cells";

interface ApiKeyCardProps {
    apiKey: ApiKeyRow;
    now: number;
    onOpen: (key: ApiKeyRow) => void;
    actions: React.ReactNode;
}

/** A key as a card: what it may do, the level of every area, its owner and its use. */
export function ApiKeyCard({ apiKey, now, onOpen, actions }: ApiKeyCardProps) {
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(apiKey)}
            className="flex min-w-0 cursor-pointer flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <KeyTile size="lg" />
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(apiKey)}
                        className={cn(
                            "block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                            quietName(apiKey)
                        )}
                    >
                        {apiKey.name}
                    </button>
                    <PrefixText prefix={apiKey.prefix} className="block truncate text-muted-foreground" />
                </div>
                <StateBadge apiKey={apiKey} now={now} />
                <div className="-mt-1 -mr-2">{actions}</div>
            </div>
            <p className="text-sm">{keyLine(apiKey)}</p>
            <LevelStrip permissions={apiKey.effective} />
            <div className="flex items-center gap-3 border-t pt-3">
                <OwnerCell apiKey={apiKey} />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {apiKey.lastUsedAt ? <>used <RelativeTime date={apiKey.lastUsedAt} /></> : "never used"}
                    {" · "}
                    {apiKey.expiresAt ? (
                        <>
                            {apiKey.state === "expired" ? "ran out " : "runs out "}
                            <RelativeTime date={apiKey.expiresAt} />
                        </>
                    ) : (
                        "never runs out"
                    )}
                </span>
            </div>
        </div>
    );
}
