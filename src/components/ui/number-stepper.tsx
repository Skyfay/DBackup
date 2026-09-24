"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface NumberStepperProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max" | "step"> {
    value: number;
    onValueChange: (value: number) => void;
    min: number;
    max: number;
    step?: number;
    /** What the buttons are called for a screen reader, like "Fewer days". */
    decrementLabel?: string;
    incrementLabel?: string;
}

const BUTTON =
    "flex w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5";

/**
 * A whole number between two limits, typed or stepped with the buttons beside it and the arrow
 * keys. What is typed counts once it is a number in range, and leaving the field puts the last one
 * that counted back, so the form never holds a value out of range. The props of a form field land
 * on the text field, so its label names it.
 */
export function NumberStepper({
    value,
    onValueChange,
    min,
    max,
    step = 1,
    decrementLabel = "Decrease",
    incrementLabel = "Increase",
    disabled,
    className,
    onBlur,
    onKeyDown,
    ...props
}: NumberStepperProps) {
    // What is typed while it is not a number in range yet, like an empty field.
    const [draft, setDraft] = React.useState<string | null>(null);
    const current = Number.isFinite(value) ? value : min;
    const stepTo = (next: number) => {
        setDraft(null);
        const clamped = Math.min(max, Math.max(min, next));
        if (clamped !== value) onValueChange(clamped);
    };

    return (
        <div
            data-slot="number-stepper"
            className={cn(
                "inline-flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30",
                // The ring takes the tone of the dialog like a text field, see --tone-ring in globals.css.
                "focus-within:border-tone-ring focus-within:ring-2 focus-within:ring-tone-ring/50 has-aria-invalid:border-destructive",
                disabled && "opacity-50",
                className,
            )}
        >
            <button type="button" tabIndex={-1} aria-label={decrementLabel} disabled={disabled || current <= min} onClick={() => stepTo(current - step)} className={BUTTON}>
                <Minus aria-hidden="true" />
            </button>
            <input
                type="text"
                inputMode="numeric"
                role="spinbutton"
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={current}
                autoComplete="off"
                disabled={disabled}
                value={draft ?? String(current)}
                onChange={(event) => {
                    const text = event.target.value.replace(/\D/g, "");
                    const next = Number.parseInt(text, 10);
                    setDraft(text);
                    if (text !== "" && next >= min && next <= max) onValueChange(next);
                }}
                onBlur={(event) => {
                    setDraft(null);
                    onBlur?.(event);
                }}
                onKeyDown={(event) => {
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        stepTo(current + (event.key === "ArrowUp" ? step : -step));
                    }
                    onKeyDown?.(event);
                }}
                className="w-11 min-w-0 border-x border-input bg-transparent text-center text-sm font-semibold tabular-nums outline-none disabled:cursor-not-allowed"
                {...props}
            />
            <button type="button" tabIndex={-1} aria-label={incrementLabel} disabled={disabled || current >= max} onClick={() => stepTo(current + step)} className={BUTTON}>
                <Plus aria-hidden="true" />
            </button>
        </div>
    );
}
