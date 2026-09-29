"use client";

import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";
import { PROVIDER_LOGOS } from "./provider-logos";

/** The logo of a sign-in provider by its adapter in its brand colors, the one of OpenID for the rest. */
export function ProviderLogo({ adapterId, className }: { adapterId: string | null | undefined; className?: string }) {
    return <Icon icon={PROVIDER_LOGOS[adapterId ?? ""] ?? PROVIDER_LOGOS.generic} className={cn("shrink-0", className)} aria-hidden="true" />;
}

/** The logo in a tile, like the icon of a connection. */
export function ProviderTile({ adapterId, size = "md" }: { adapterId: string | null | undefined; size?: "sm" | "md" | "lg" }) {
    const box = { sm: "size-7", md: "size-8", lg: "size-11" }[size];
    const mark = { sm: "size-4", md: "size-[18px]", lg: "size-6" }[size];
    return (
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg border bg-muted/50", box)} aria-hidden="true">
            <ProviderLogo adapterId={adapterId} className={mark} />
        </span>
    );
}
