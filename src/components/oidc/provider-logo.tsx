"use client";

import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";
import { PROVIDER_LOGOS } from "./provider-logos";

/**
 * The logo of a sign-in provider by its adapter, the one of any OpenID Connect provider for the
 * rest. A logo with a variant for a dark background swaps to it in dark mode, by CSS so it never
 * flashes after loading.
 */
export function ProviderLogo({ adapterId, className }: { adapterId: string | null | undefined; className?: string }) {
    const logo = PROVIDER_LOGOS[adapterId ?? ""] ?? PROVIDER_LOGOS.generic;
    if (!logo.onDark) return <Icon icon={logo.icon} className={cn("shrink-0", className)} aria-hidden="true" />;
    return (
        <>
            <Icon icon={logo.icon} className={cn("shrink-0 dark:hidden", className)} aria-hidden="true" />
            <Icon icon={logo.onDark} className={cn("hidden shrink-0 dark:block", className)} aria-hidden="true" />
        </>
    );
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
