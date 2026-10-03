"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ZOOMS, type TimelineZoom } from "./job-timeline-model";

/** The zoom of both views, a segmented switch like every range. */
export function ZoomTabs({ value, onChange }: { value: TimelineZoom; onChange: (zoom: TimelineZoom) => void }) {
    return (
        <Tabs value={value} onValueChange={(next) => onChange(next as TimelineZoom)}>
            <TabsList className="h-8" aria-label="Range">
                {ZOOMS.map((zoom) => (
                    <TabsTrigger key={zoom.value} value={zoom.value} className="px-2.5 text-xs">{zoom.label}</TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    );
}

/** Back and on a screen at a time, and Now, as far as the loaded week reaches. */
export function RangeNav({ canBack, canForward, atNow, onBack, onNow, onForward }: {
    canBack: boolean;
    canForward: boolean;
    atNow: boolean;
    onBack: () => void;
    onNow: () => void;
    onForward: () => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="size-8" aria-label="Earlier" onClick={onBack} disabled={!canBack}>
                <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={onNow} disabled={atNow}>Now</Button>
            <Button variant="outline" size="icon" className="size-8" aria-label="Later" onClick={onForward} disabled={!canForward}>
                <ChevronRight />
            </Button>
        </div>
    );
}

/**
 * The width of an element, measured whenever it changes. Zero until it is measured. The ref is a
 * callback, so an element that only shows once the runs are in is measured as well.
 */
export function useWidth<T extends HTMLElement>() {
    const [element, setElement] = useState<T | null>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return { ref: setElement, width };
}
