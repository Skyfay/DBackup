"use client";

import { useFormContext } from "react-hook-form";
import { KeyRound, ShieldCheck } from "lucide-react";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { SwitchList } from "@/components/adapter/setting-switches";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EncryptionKeyPicker } from "./encryption-key-picker";
import { NO_ENCRYPTION, type EncryptionOption, type JobFormValues } from "./job-form-schema";
import { SchedulePicker } from "./schedule-picker";
import { SchedulePresetField } from "./schedule-preset-field";
import { useSchedulerTimezone } from "./use-scheduler-timezone";

/** The label of the preset field, with the time zone the times of the presets are in. */
function PresetLabel() {
    const timezone = useSchedulerTimezone();
    return (
        <div className="flex items-baseline justify-between gap-3">
            <FormLabel>Preset</FormLabel>
            {timezone && <span className="text-xs text-muted-foreground">Times in {timezone}</span>}
        </div>
    );
}

/** Its name, whether it runs on its own and when. The job being edited is left out of the jobs its schedule could meet. */
export function BasicsPart({ jobId }: { jobId?: string }) {
    const form = useFormContext<JobFormValues>();
    const mode = form.watch("scheduleMode");

    return (
        <>
            <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                            <Input placeholder="Shop nightly" autoComplete="off" {...field} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <SwitchList>
                <FormField
                    control={form.control}
                    name="enabled"
                    render={({ field }) => (
                        <FormItem className="flex items-center gap-4 px-4 py-3">
                            <div className="grid min-w-0 flex-1 gap-0.5">
                                <FormLabel>Runs on its schedule</FormLabel>
                                <p className="text-xs text-muted-foreground">A paused job only runs when it is started by hand or through the API.</p>
                            </div>
                            <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </SwitchList>
            <FormField
                control={form.control}
                name="scheduleMode"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>When it runs</FormLabel>
                        <FormControl>
                            <ChoiceCards
                                value={field.value}
                                onValueChange={field.onChange}
                                aria-label="When it runs"
                                options={[
                                    { value: "own", title: "Its own schedule", description: "Set here, for this job only." },
                                    { value: "preset", title: "A schedule preset", description: "Follows the preset, changes to it apply here too." },
                                ]}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />
            {mode === "own" ? (
                <FormField
                    control={form.control}
                    name="schedule"
                    render={({ field }) => (
                        <FormItem>
                            {/* The picker says itself what is wrong with a schedule, so no message of the form repeats it. */}
                            <SchedulePicker value={field.value} onChange={field.onChange} jobId={jobId} />
                        </FormItem>
                    )}
                />
            ) : (
                <FormField
                    control={form.control}
                    name="schedulePresetId"
                    render={({ field }) => (
                        <FormItem>
                            <PresetLabel />
                            <FormControl>
                                <SchedulePresetField
                                    jobId={jobId}
                                    value={field.value}
                                    onChange={(preset) => {
                                        field.onChange(preset?.id ?? null);
                                        // The job keeps the expression too, so the scheduler has it even without the preset.
                                        if (preset) form.setValue("schedule", preset.schedule, { shouldValidate: true });
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
        </>
    );
}

/** The key every backup of the job is encrypted with, or none. */
export function EncryptionPart({ encryptionProfiles }: { encryptionProfiles: EncryptionOption[] }) {
    const form = useFormContext<JobFormValues>();
    const encrypted = form.watch("encryptionProfileId") !== NO_ENCRYPTION;

    return (
        <>
            <FormField
                control={form.control}
                name="encryptionProfileId"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Key</FormLabel>
                        <FormControl>
                            <EncryptionKeyPicker keys={encryptionProfiles} value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <ul className="grid gap-3 text-sm text-muted-foreground">
                <li className="flex gap-3">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {encrypted
                        ? "Every backup is encrypted before it is uploaded, so the destinations only ever hold encrypted files."
                        : "Without a key the backups are stored as they are, readable by anyone who can open the destination."}
                </li>
                {encrypted && (
                    <li className="flex gap-3">
                        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        A restore needs the key. Keep its recovery kit from the Vault somewhere safe, without it the backups cannot be opened.
                    </li>
                )}
            </ul>
        </>
    );
}
