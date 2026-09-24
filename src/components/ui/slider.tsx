"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** Half the thumb's width, which Radix keeps inside the track at both ends. */
const HALF_THUMB = 8;

interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
    /** A value to mark on the track, like the default of a level. */
    mark?: number;
}

/**
 * A value on a track, like the compression level of a job. The range and the thumb take the tone
 * of the form around them, like a switch. The thumb carries the name of the slider, since it is
 * the part a screen reader and the keyboard work with.
 */
function Slider({ className, mark, min = 0, max = 100, "aria-label": ariaLabel, ...props }: SliderProps) {
    const percent = mark === undefined ? 0 : ((mark - min) / (max - min)) * 100;
    return (
        <SliderPrimitive.Root
            data-slot="slider"
            min={min}
            max={max}
            className={cn("relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50", className)}
            {...props}
        >
            <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
                <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-tone-control" />
            </SliderPrimitive.Track>
            {mark !== undefined && (
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/60"
                    // Where the thumb stands at that value, which Radix moves inwards near the ends.
                    style={{ left: `calc(${percent}% + ${HALF_THUMB * (1 - percent / 50)}px)` }}
                />
            )}
            <SliderPrimitive.Thumb
                data-slot="slider-thumb"
                aria-label={ariaLabel}
                className="block size-4 shrink-0 rounded-full border-2 border-tone-control bg-background shadow-sm transition-[box-shadow] outline-none hover:ring-4 hover:ring-tone-ring/30 focus-visible:ring-4 focus-visible:ring-tone-ring/50 disabled:pointer-events-none"
            />
        </SliderPrimitive.Root>
    );
}

export { Slider };
