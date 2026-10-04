"use client";

import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { cn } from "@/lib/utils";
import type { LoginAdapters } from "@/services/auth/login-page-service";

/** Each row its own speed and direction, written out whole so Tailwind finds the classes. */
const MOTION = [
    "motion-safe:animate-[login-drift_70s_linear_infinite]",
    "motion-safe:animate-[login-drift_90s_linear_infinite_reverse]",
    "motion-safe:animate-[login-drift_64s_linear_infinite]",
];

function Row({ ids, motion, small }: { ids: string[]; motion: string; small: boolean }) {
    // The logos twice, and the row moves by half its width, so the loop never shows a seam.
    const tiles = [...ids, ...ids];
    return (
        <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
            <div className={cn("flex w-max", small ? "gap-2.5 pr-2.5" : "gap-3.5 pr-3.5", motion)}>
                {tiles.map((id, index) => (
                    <span
                        key={`${id}-${index}`}
                        className={cn(
                            "flex shrink-0 items-center justify-center border bg-background/70 dark:bg-foreground/[0.07]",
                            small ? "size-11 rounded-xl" : "size-18 rounded-[1.125rem]"
                        )}
                    >
                        <AdapterIcon adapterId={id} className={small ? "size-5.5" : "size-8.5"} />
                    </span>
                ))}
            </div>
        </div>
    );
}

/**
 * The logos of every adapter in rows that drift in turns, databases, storage and channels, so a
 * new adapter joins its row by itself and the rows never fill up. One row on a phone. They stand
 * still with Reduce motion in the system.
 */
export function LogoRows({ adapters, single = false, className }: { adapters: LoginAdapters; single?: boolean; className?: string }) {
    const rows = single ? [[...adapters.databases, ...adapters.storage]] : [adapters.databases, adapters.storage, adapters.notifications];
    return (
        <div className={cn("flex flex-col", !single && "gap-4", className)} aria-hidden="true">
            {rows.map((ids, index) => (
                <Row key={index} ids={ids} motion={MOTION[index]} small={single} />
            ))}
        </div>
    );
}
