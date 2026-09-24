"use client";

import { useFormContext } from "react-hook-form";
import { Bell, KeyRound, ShieldCheck, Trash2, X } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { SwitchList } from "@/components/adapter/setting-switches";
import { NotificationTemplatePicker } from "@/components/templates/notification-template-picker";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NO_ENCRYPTION, type AdapterOption, type EncryptionOption, type JobFormValues } from "./job-form-schema";
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
                        <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value={NO_ENCRYPTION}>No encryption</SelectItem>
                                {encryptionProfiles.map((profile) => (
                                    <SelectItem key={profile.id} value={profile.id}>
                                        {profile.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormDescription>{encryptionProfiles.length === 0 ? "The Vault holds no keys yet. Add one there to encrypt this job." : "Keys live in the Vault."}</FormDescription>
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

const EVENTS: { value: string; label: string }[] = [
    { value: "SUCCESS|PARTIAL|FAILED", label: "After every run" },
    { value: "PARTIAL|FAILED", label: "When a run fails or is partial" },
    { value: "SUCCESS", label: "When a run succeeds" },
];

/** Who hears about a run: notification templates, or the channels an older job names directly. */
export function NotificationsPart({ notifications }: { notifications: AdapterOption[] }) {
    const form = useFormContext<JobFormValues>();
    const templates = form.watch("notificationTemplateIds");
    const channelIds = form.watch("notificationIds");
    const events = form.watch("notificationEvents").join("|");
    const channels = channelIds.map((id) => notifications.find((option) => option.id === id) ?? { id, name: "Unknown channel", adapterId: "" });

    return (
        <>
            <div className="space-y-2">
                <p className="text-sm font-medium">Notification templates</p>
                {templates.map((templateId, index) => (
                    <div key={templateId} className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                            <NotificationTemplatePicker
                                value={templateId}
                                onChange={(id) => {
                                    if (!id) return;
                                    form.setValue("notificationTemplateIds", templates.map((current, position) => (position === index ? id : current)), { shouldDirty: true });
                                }}
                                usedIds={templates.filter((_, position) => position !== index)}
                            />
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            className="size-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => form.setValue("notificationTemplateIds", templates.filter((_, position) => position !== index), { shouldDirty: true })}
                            aria-label="Remove template"
                        >
                            <Trash2 />
                        </Button>
                    </div>
                ))}
                <NotificationTemplatePicker
                    value={null}
                    onChange={(id) => {
                        if (id && !templates.includes(id)) form.setValue("notificationTemplateIds", [...templates, id], { shouldDirty: true });
                    }}
                    placeholder="Add a notification template"
                    usedIds={templates}
                />
                <p className="text-xs text-muted-foreground">Each template decides its channels and after which runs it sends.</p>
            </div>

            {channels.length > 0 && (
                <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-start gap-3">
                        <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <p className="text-sm">
                            <span className="font-medium">Channels named directly</span>
                            <span className="block text-xs text-muted-foreground">
                                {templates.length > 0 ? "A template is set, so these are not used. Remove them to tidy up." : "Set by the Quick Setup or an older version, without a template."}
                            </span>
                        </p>
                    </div>
                    <ul className="divide-y rounded-md border">
                        {channels.map((channel) => (
                            <li key={channel.id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm">
                                {channel.adapterId && <AdapterIcon adapterId={channel.adapterId} className="size-4 shrink-0" />}
                                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="size-7 p-0 text-muted-foreground"
                                    onClick={() => form.setValue("notificationIds", channelIds.filter((id) => id !== channel.id), { shouldDirty: true })}
                                    aria-label={`Remove ${channel.name}`}
                                >
                                    <X />
                                </Button>
                            </li>
                        ))}
                    </ul>
                    {templates.length === 0 && (
                        <Select
                            value={EVENTS.some((option) => option.value === events) ? events : EVENTS[0].value}
                            onValueChange={(value) => form.setValue("notificationEvents", value.split("|") as JobFormValues["notificationEvents"], { shouldDirty: true })}
                        >
                            <SelectTrigger className="w-full" aria-label="When they are told">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EVENTS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>
            )}
        </>
    );
}
