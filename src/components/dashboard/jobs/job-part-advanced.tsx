"use client";

import { useFormContext } from "react-hook-form";
import { SwitchList } from "@/components/adapter/setting-switches";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { FileNamesField } from "./file-names-field";
import type { JobFormValues } from "./job-form-schema";

/** File names and integrity checks. Incremental backups have a part of their own. */
export function AdvancedPart() {
    const form = useFormContext<JobFormValues>();

    return (
        <>
            <FileNamesField />

            <SwitchList>
                <FormField
                    control={form.control}
                    name="skipVerification"
                    render={({ field }) => (
                        <FormItem className="flex items-center gap-4 px-4 py-3">
                            <div className="grid min-w-0 flex-1 gap-0.5">
                                <FormLabel>Integrity checks</FormLabel>
                                <p className="text-xs text-muted-foreground">Includes the backups of this job in the scheduled integrity check.</p>
                            </div>
                            <FormControl>
                                <Switch checked={!field.value} onCheckedChange={(on) => field.onChange(!on)} />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </SwitchList>
        </>
    );
}
