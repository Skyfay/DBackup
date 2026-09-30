"use client";

import { useEffect, useId, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { ChevronDown, CircleCheck, Palette, TriangleAlert } from "lucide-react";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toneAttribute } from "@/components/ui/tone";
import {
    COLOR_FAMILIES,
    COLOR_FAMILY_NAMES,
    THEME_SURFACES,
    colorName,
    contrastRatio,
    shadesOf,
    type TaskColorValue,
} from "@/lib/core/task-colors";
import { cn } from "@/lib/utils";

/** A color as a small square. The shade is computed, so it goes in as a style. */
export function Swatch({ color, className }: { color: string; className?: string }) {
    return <span className={cn("inline-block size-4 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]", className)} style={{ backgroundColor: color }} aria-hidden="true" />;
}

const HEX = /^#[0-9a-f]{6}$/;

/** How well a shade reads on the surface of its theme, as the WCAG ratio for text. */
function ContrastLine({ label, color, surface }: { label: string; color: string; surface: string }) {
    const ratio = contrastRatio(color, surface);
    const readable = ratio >= 4.5;
    return (
        <p className={cn("flex items-center gap-1.5 text-xs", readable ? "text-foreground" : "text-warning")}>
            {readable ? <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" /> : <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
            {label} {readable ? "reads well" : "is hard to read"}, {ratio.toFixed(1)} to 1
        </p>
    );
}

interface ColorPickerProps {
    task: string;
    value: TaskColorValue;
    onChange: (value: TaskColorValue) => void;
    /** The shade of the swatches, the one of the theme the viewer looks at. */
    theme: "light" | "dark";
}

/**
 * The colors of a task as the button of its row, both shades side by side, and the popover that
 * picks one: a family, or an own color whose dark shade is worked out, with how well each reads.
 */
export function ColorPicker({ task, value, onChange, theme }: ColorPickerProps) {
    const [open, setOpen] = useState(false);
    const [own, setOwn] = useState(value.startsWith("#") ? value : "");
    // The field to pick any color, open from the start for a color of the person's own.
    const [free, setFree] = useState(value.startsWith("#"));
    const ownId = useId();
    const shades = shadesOf(value);
    const current = HEX.test(own.toLowerCase()) ? own.toLowerCase() : shades.light;

    useEffect(() => {
        if (!open) return;
        setOwn(value.startsWith("#") ? value : "");
        setFree(value.startsWith("#"));
        // Only a new opening starts from the value, not every pick while it is open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const pickOwn = (hex: string) => {
        setOwn(hex);
        onChange(hex.toLowerCase() as TaskColorValue);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    {...toneAttribute("pick")}
                    aria-label={`Color of ${task}: ${colorName(value)}`}
                    className={cn(
                        "inline-flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs outline-none transition-colors hover:bg-muted/50 focus-visible:border-tone-ring focus-visible:ring-2 focus-visible:ring-tone-ring/50",
                        open && "border-tone ring-2 ring-tone/25"
                    )}
                >
                    <Swatch color={shades.light} />
                    <span className="font-mono">{shades.light}</span>
                    <span className="h-4 w-px bg-border" aria-hidden="true" />
                    <Swatch color={shades.dark} />
                    <span className="font-mono">{shades.dark}</span>
                    <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </button>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="end" className="w-80 overflow-hidden bg-raised p-0">
                <DialogHead tone="pick" icon={Palette} className="px-4 py-3">
                    <p className="text-sm font-semibold">Color of {task}</p>
                    <p className={dialogNoteClass("pick")}>Both themes, one pick</p>
                </DialogHead>
                <div className="grid gap-3 p-4">
                    <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Colors</p>
                        <div role="radiogroup" aria-label={`Color of ${task}`} className="grid grid-cols-8 gap-2">
                            {COLOR_FAMILY_NAMES.map((family) => {
                                const picked = value === family;
                                return (
                                    <button
                                        key={family}
                                        type="button"
                                        role="radio"
                                        aria-checked={picked}
                                        aria-label={colorName(family)}
                                        title={colorName(family)}
                                        onClick={() => {
                                            setOwn("");
                                            onChange(family);
                                        }}
                                        className={cn(
                                            "size-7 rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-raised",
                                            picked && "ring-2 ring-foreground ring-offset-2 ring-offset-raised"
                                        )}
                                        style={{ backgroundColor: COLOR_FAMILIES[family][theme] }}
                                    />
                                );
                            })}
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor={ownId} className="text-xs text-muted-foreground">Your own</Label>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                aria-expanded={free}
                                aria-label={free ? "Hide the color field" : "Pick any color"}
                                title={free ? "Hide the color field" : "Pick any color"}
                                onClick={() => setFree((shown) => !shown)}
                                className="size-9 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-raised"
                                style={{ backgroundColor: current }}
                            />
                            <Input
                                id={ownId}
                                value={own}
                                placeholder={shades.light}
                                maxLength={7}
                                className="font-mono"
                                onChange={(event) => {
                                    const next = event.target.value.trim();
                                    setOwn(next);
                                    if (HEX.test(next.toLowerCase())) onChange(next.toLowerCase() as TaskColorValue);
                                }}
                            />
                        </div>
                        {free && (
                            // Any color: the shade across the field, the hue in the bar below it.
                            <HexColorPicker color={current} onChange={pickOwn} className="mt-1 h-36! w-full!" />
                        )}
                    </div>
                    <div className="grid gap-1">
                        <ContrastLine label={`On white ${shades.light}`} color={shades.light} surface={THEME_SURFACES.light} />
                        <ContrastLine label={`In the dark theme ${shades.dark}`} color={shades.dark} surface={THEME_SURFACES.dark} />
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
