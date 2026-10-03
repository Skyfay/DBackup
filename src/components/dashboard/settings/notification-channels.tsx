"use client";

import { useId } from "react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { connectionAddress } from "@/lib/adapters/connection-summary";
import type { AdapterListItemDTO } from "@/lib/adapters/dto";
import { cn } from "@/lib/utils";

/** The logos of the channels an event goes to, overlapping a little like the faces of a group. */
export function ChannelLogos({ channels, className }: { channels: AdapterListItemDTO[]; className?: string }) {
    return (
        <span className={cn("flex shrink-0 items-center -space-x-1", className)} aria-hidden="true">
            {channels.slice(0, 4).map((channel) => (
                <span key={channel.id} className="flex size-5 items-center justify-center rounded-md border bg-card">
                    <AdapterIcon adapterId={channel.adapterId} className="size-3.5" />
                </span>
            ))}
        </span>
    );
}

interface ChannelChecklistProps {
    channels: AdapterListItemDTO[];
    value: string[];
    onChange: (ids: string[]) => void;
    disabled?: boolean;
}

/** Every notification channel with its type and address, a box each, for where an event goes. */
export function ChannelChecklist({ channels, value, onChange, disabled }: ChannelChecklistProps) {
    const id = useId();
    const toggle = (channelId: string, checked: boolean) =>
        onChange(checked ? [...value, channelId] : value.filter((entry) => entry !== channelId));
    return (
        <ul className="divide-y overflow-hidden rounded-lg border">
            {channels.map((channel) => {
                const address = channel.config ? connectionAddress(channel.adapterId, channel.config) : null;
                const boxId = `${id}-${channel.id}`;
                return (
                    <li key={channel.id}>
                        <Label htmlFor={boxId} className={cn("flex min-w-0 items-center gap-3 px-3 py-2.5 font-normal", disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/40")}>
                            <Checkbox id={boxId} checked={value.includes(channel.id)} onCheckedChange={(checked) => toggle(channel.id, checked === true)} disabled={disabled} />
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/50" aria-hidden="true">
                                <AdapterIcon adapterId={channel.adapterId} className="size-4" />
                            </span>
                            <span className="grid min-w-0 flex-1 gap-0.5">
                                <span className="truncate text-sm font-medium">{channel.name}</span>
                                {address && <span className="truncate text-xs text-muted-foreground">{address}</span>}
                            </span>
                        </Label>
                    </li>
                );
            })}
        </ul>
    );
}
