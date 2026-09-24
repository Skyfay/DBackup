"use client";

import { useFormContext } from "react-hook-form";
import { SwitchList } from "@/components/adapter/setting-switches";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FileNamesField } from "./file-names-field";
import type { JobFormValues } from "./job-form-schema";

/** File names, incremental backups and integrity checks. */
export function AdvancedPart() {
    const form = useFormContext<JobFormValues>();
    const mode = form.watch("sourceMode");
    const incremental = form.watch("backupMode") === "INCREMENTAL";
    const withFolders = mode !== "db";

    return (
        <>
            <FileNamesField />

            <SwitchList>
                {withFolders && (
                    <FormField
                        control={form.control}
                        name="backupMode"
                        render={({ field }) => (
                            <FormItem className="flex items-center gap-4 px-4 py-3">
                                <div className="grid min-w-0 flex-1 gap-0.5">
                                    <FormLabel>Incremental backups</FormLabel>
                                    <p className="text-xs text-muted-foreground">
                                        Folders only store what changed since the last run. A backup then depends on the full one its chain starts with.
                                        {mode === "both" && " The database is always dumped in full."}
                                    </p>
                                </div>
                                <FormControl>
                                    <Switch checked={field.value === "INCREMENTAL"} onCheckedChange={(on) => field.onChange(on ? "INCREMENTAL" : "FULL")} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}
                {withFolders && incremental && (
                    <FormField
                        control={form.control}
                        name="verifyByHash"
                        render={({ field }) => (
                            <FormItem className="flex items-center gap-4 px-4 py-3">
                                <div className="grid min-w-0 flex-1 gap-0.5">
                                    <FormLabel>Detect changes by content</FormLabel>
                                    <p className="text-xs text-muted-foreground">
                                        Reads every file instead of trusting its size and time. Only needed where those can stay the same after a change.
                                    </p>
                                </div>
                                <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}
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

            {withFolders && incremental && (
                <FormField
                    control={form.control}
                    name="fullEveryDays"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Full backup every</FormLabel>
                            <div className="flex items-center gap-2">
                                <FormControl>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={365}
                                        className="w-24"
                                        value={Number.isNaN(field.value) ? "" : field.value}
                                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                                    />
                                </FormControl>
                                <span className="text-sm text-muted-foreground">days</span>
                            </div>
                            <FormDescription>Starts a new chain this often. Shorter chains use more space and lose less when a full backup is damaged.</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
        </>
    );
}
