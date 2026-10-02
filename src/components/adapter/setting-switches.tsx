"use client";

import { useId } from "react";
import { useFormContext } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Switches that belong together, in one frame with a line between them. */
export function SwitchList({ children }: { children: React.ReactNode }) {
    return <div className="divide-y rounded-lg border">{children}</div>;
}

interface SwitchRowProps {
    title: string;
    description?: React.ReactNode;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    /** What the setting needs besides on or off, beside the switch, like how many. */
    aside?: React.ReactNode;
}

/**
 * One setting as a sentence that is true when the switch is on. Settings the connection
 * stores the other way round, like `healthNotificationsDisabled`, are turned around by the
 * caller, so on always means on.
 */
export function SwitchRow({ title, description, checked, onCheckedChange, disabled, aside }: SwitchRowProps) {
    const id = useId();
    return (
        // With something beside the switch, both move under the words where the row is too narrow for all three.
        // The switch keeps its place in the tree either way, so it keeps the focus when that appears.
        <div className={cn("flex items-center gap-4 px-4 py-3", aside && "flex-wrap gap-y-2")}>
            <div className={cn("grid min-w-0 flex-1 gap-0.5", aside && "basis-48")}>
                <Label htmlFor={id}>{title}</Label>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
            <div className="ml-auto flex items-center gap-4">
                {aside}
                <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
            </div>
        </div>
    );
}

/** A switch bound to a boolean of the adapter's config. */
export function ConfigSwitchRow({ fieldKey, title, description }: { fieldKey: string; title: string; description?: string }) {
    const { control } = useFormContext();
    return (
        <FormField
            control={control}
            name={`config.${fieldKey}`}
            render={({ field }) => (
                <FormItem className="flex items-center gap-4 px-4 py-3">
                    <div className="grid min-w-0 flex-1 gap-0.5">
                        <FormLabel>{title}</FormLabel>
                        {description && <p className="text-xs text-muted-foreground">{description}</p>}
                    </div>
                    <FormControl>
                        <Switch checked={field.value === true} onCheckedChange={field.onChange} />
                    </FormControl>
                </FormItem>
            )}
        />
    );
}
