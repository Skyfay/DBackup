"use client";

import { useId } from "react";
import { useFormContext } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export interface ModeOption {
    value: string;
    title: string;
    description: string;
    beta?: boolean;
    /** A word beside the title, like Default, or why the card cannot be picked. */
    badge?: string;
    disabled?: boolean;
}

interface ChoiceCardsProps extends Omit<React.ComponentProps<typeof RadioGroup>, "value" | "onValueChange" | "children"> {
    value: string;
    onValueChange: (value: string) => void;
    options: ModeOption[];
}

/**
 * A few options as cards with one sentence each, where a click anywhere on a card picks it.
 *
 * For a choice that decides what the rest of the form asks for, and cards rather than a
 * select, because the sentence is what makes the choice: "Over SSH" alone does not say that
 * the dump then runs on that server. The picked card shows the tone of the form around it,
 * blue while adding and violet while editing.
 */
export function ChoiceCards({ value, onValueChange, options, className, ...props }: ChoiceCardsProps) {
    const id = useId();
    return (
        <RadioGroup value={value} onValueChange={onValueChange} className={cn("grid gap-2.5 sm:grid-cols-2", className)} {...props}>
            {options.map((option) => (
                <Label
                    key={option.value}
                    htmlFor={`${id}-${option.value}`}
                    className="cursor-pointer items-start gap-3 rounded-lg border p-3 leading-normal font-normal transition-colors hover:bg-muted/40 has-disabled:cursor-not-allowed has-disabled:opacity-55 has-disabled:hover:bg-transparent has-data-[state=checked]:border-tone-control/60 has-data-[state=checked]:bg-tone-control/5 dark:has-data-[state=checked]:bg-tone-control/10"
                >
                    <RadioGroupItem
                        id={`${id}-${option.value}`}
                        value={option.value}
                        disabled={option.disabled}
                        className="mt-0.5 shrink-0"
                    />
                    <span className="grid min-w-0 gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            {option.title}
                            {option.beta && (
                                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Beta</span>
                            )}
                            {option.badge && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{option.badge}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                </Label>
            ))}
        </RadioGroup>
    );
}

/** The cards bound to a config key of the form, such as `connectionMode`. */
export function ModeChoice({ fieldKey, label, options }: { fieldKey: string; label: string; options: ModeOption[] }) {
    const { control } = useFormContext();
    return (
        <FormField
            control={control}
            name={`config.${fieldKey}`}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                        <ChoiceCards value={typeof field.value === "string" ? field.value : ""} onValueChange={field.onChange} options={options} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
