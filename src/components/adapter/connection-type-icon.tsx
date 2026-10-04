"use client";

import type { ComponentType } from "react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";

type IconComponent = ComponentType<{ className?: string }>;

// One component per adapter, made once, so the filter list does not remount its icons on every poll.
const icons = new Map<string, IconComponent>();

/** The brand icon of an adapter type, in the shape the filter options take. */
export function adapterTypeIcon(adapterId: string): IconComponent {
    let icon = icons.get(adapterId);
    if (!icon) {
        icon = function AdapterTypeIcon({ className }: { className?: string }) {
            return <AdapterIcon adapterId={adapterId} className={className} />;
        };
        icons.set(adapterId, icon);
    }
    return icon;
}
