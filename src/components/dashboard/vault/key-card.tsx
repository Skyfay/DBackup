"use client";

import { CircleCheck, Download, Eye, TriangleAlert } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { isPlainClick } from "@/components/ui/row-click";
import { cn } from "@/lib/utils";
import type { VaultKey } from "@/services/vault/vault-types";
import { DestinationShare, JobStack, KeyIdText, KeyTile } from "./vault-cells";
import { count } from "./vault-format";

interface KeyCardProps {
    keyRow: VaultKey;
    onOpen: (key: VaultKey) => void;
    actions: React.ReactNode;
    /** Downloads its recovery kit, the one step a key that was never in a kit still needs. */
    onKit?: (key: VaultKey) => void;
    onReveal?: (key: VaultKey) => void;
}

/** An encryption key on a phone: what encrypts with it, what it protects and whether it is in a recovery kit. */
export function KeyCard({ keyRow, onOpen, actions, onKit, onReveal }: KeyCardProps) {
    const kit = keyRow.kit;
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(keyRow)}
            className={cn(
                "flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20",
                !kit && "border-warning/45"
            )}
        >
            <div className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                    <KeyTile size="lg" />
                    <div className="min-w-0 flex-1">
                        <button
                            type="button"
                            onClick={() => onOpen(keyRow)}
                            className="block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            {keyRow.name}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">{keyRow.description || "no description"}</p>
                    </div>
                    <div className="-mt-1 -mr-2">{actions}</div>
                </div>
                <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Key ID</dt>
                    <dd><KeyIdText keyId={keyRow.keyId} /></dd>
                    <dt className="text-muted-foreground">Encrypts</dt>
                    <dd className="min-w-0"><JobStack jobs={keyRow.jobs} configBackup={keyRow.configBackup} /></dd>
                    <dt className="text-muted-foreground">Protects</dt>
                    <dd className="truncate">
                        {keyRow.backups > 0 ? `${count(keyRow.backups, "backup")} at ${count(keyRow.destinations.length, "destination")}` : "no backup"}
                    </dd>
                </dl>
                <DestinationShare destinations={keyRow.destinations} total={keyRow.backups} rows={false} />
            </div>
            <div className="flex min-h-12 items-center gap-2 border-t bg-muted/30 py-2 pr-2 pl-4">
                {kit ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                        <span className="truncate">In a kit, <RelativeTime date={kit.at} /></span>
                    </span>
                ) : (
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-warning">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">Never in a recovery kit</span>
                    </span>
                )}
                <span className="ml-auto shrink-0">
                    {!kit && onKit ? (
                        <Button variant="outline" size="sm" onClick={() => onKit(keyRow)}>
                            <Download />
                            Download kit
                        </Button>
                    ) : kit && onReveal ? (
                        <Button variant="ghost" size="sm" onClick={() => onReveal(keyRow)}>
                            <Eye />
                            Reveal key
                        </Button>
                    ) : null}
                </span>
            </div>
        </div>
    );
}
