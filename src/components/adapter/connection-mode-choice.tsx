"use client";

import { useId } from "react";
import { useFormContext } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export interface ModeOption {
    value: string;
    title: string;
    description: string;
    beta?: boolean;
}

interface ModeChoiceProps {
    /** A config key, such as `connectionMode`. */
    fieldKey: string;
    label: string;
    options: ModeOption[];
}

/**
 * A choice that decides what the rest of the form asks for, as cards with one sentence each.
 *
 * Cards rather than a select, because the sentence is what makes the choice: "Over SSH" alone
 * does not say that the dump then runs on that server.
 */
export function ModeChoice({ fieldKey, label, options }: ModeChoiceProps) {
    const { control } = useFormContext();
    const id = useId();
    return (
        <FormField
            control={control}
            name={`config.${fieldKey}`}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                        <RadioGroup
                            value={typeof field.value === "string" ? field.value : ""}
                            onValueChange={field.onChange}
                            className="grid gap-2.5 sm:grid-cols-2"
                        >
                            {options.map((option) => (
                                // The whole card is the label, so a click anywhere on it picks the option.
                                <Label
                                    key={option.value}
                                    htmlFor={`${id}-${option.value}`}
                                    className="cursor-pointer items-start gap-3 rounded-lg border p-3 leading-normal font-normal transition-colors hover:bg-muted/40 has-data-[state=checked]:border-info/60 has-data-[state=checked]:bg-info/5 dark:has-data-[state=checked]:bg-info/10"
                                >
                                    <RadioGroupItem
                                        id={`${id}-${option.value}`}
                                        value={option.value}
                                        className="mt-0.5 shrink-0 border-input data-[state=checked]:border-info data-[state=checked]:text-info"
                                    />
                                    <span className="grid min-w-0 gap-0.5">
                                        <span className="flex items-center gap-1.5 text-sm font-medium">
                                            {option.title}
                                            {option.beta && (
                                                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Beta</span>
                                            )}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{option.description}</span>
                                    </span>
                                </Label>
                            ))}
                        </RadioGroup>
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
