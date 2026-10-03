"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One turn of `animate-spin`. A refresh turns at least once, and always stops on a whole turn. */
export const SPIN_MS = 1000;

interface RefreshButtonProps extends Omit<React.ComponentProps<typeof Button>, "onClick" | "children"> {
    /** Loads again. A promise keeps the button turning until it settles. */
    onRefresh: () => unknown;
    /** Loading that runs anyway, like the first load of a list, which turns the button as well. */
    busy?: boolean;
    /** Names the button for screen readers, like "Refresh" or "Load the volumes again". */
    label: string;
    icon?: LucideIcon;
    iconClassName?: string;
}

/**
 * The button that loads a list again. A click turns its arrows for at least one full turn, longer
 * while the load runs, so a list that comes back in a blink still shows it was asked. Clicks while
 * it turns are ignored, so it cannot be fired again and again. The button keeps its look meanwhile
 * instead of dimming, which would hide the turn.
 */
export function RefreshButton({ onRefresh, busy = false, label, icon: Icon = RefreshCw, iconClassName, className, variant = "ghost", size = "icon", ...props }: RefreshButtonProps) {
    const [spinning, setSpinning] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);
    const turning = spinning || busy;

    const refresh = async () => {
        if (turning) return;
        setSpinning(true);
        const started = Date.now();
        try {
            await onRefresh();
        } catch {
            // Whoever loads reports its own failure, the button only stops turning.
        } finally {
            const elapsed = Date.now() - started;
            const turns = Math.max(1, Math.ceil(elapsed / SPIN_MS));
            timer.current = setTimeout(() => setSpinning(false), turns * SPIN_MS - elapsed);
        }
    };

    return (
        <Button
            type="button"
            variant={variant}
            size={size}
            aria-label={label}
            aria-busy={turning}
            aria-disabled={turning}
            onClick={() => void refresh()}
            className={cn(turning && "cursor-default", className)}
            {...props}
        >
            <Icon className={cn(turning && "animate-spin", iconClassName)} />
        </Button>
    );
}
