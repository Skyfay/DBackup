"use client";

import { saveGeneralSettingsAction } from "@/app/actions/settings/settings";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Input } from "@/components/ui/input";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GeneralSettings } from "@/services/system/settings-types";
import { Field, PartFrame, SaveBar, useSettingsFrame, usePartSave, usePartValues } from "./settings-frame";
import { STUCK_CHOICES, changesOf, minutesText, withSaved, zoneExample } from "./settings-values";
import { TimezoneField } from "./timezone-field";

export const MAX_RUNS = 10;

/** The words of the save bar for this part. */
export const GENERAL_FIELDS = {
    instanceName: { label: "Name" },
    timezone: { label: "Time zone" },
    maxConcurrentJobs: { label: "Runs at the same time" },
    stuckTimeoutMinutes: { label: "Fail a run that stops reporting after", show: minutesText },
    checkForUpdates: { label: "Look for new versions" },
    showQuickSetup: { label: "Show Quick Setup in the sidebar" },
} as const;

/** The name of the instance, the clock of the scheduler, how many runs start at once and two switches. */
export function GeneralPart({ saved }: { saved: GeneralSettings }) {
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("general", saved);
    const save = usePartSave("general");
    const { values, set } = form;
    const name = values.instanceName.trim();

    return (
        <>
            <PartFrame part="general">
                <fieldset disabled={readOnly} className="min-w-0 space-y-6">
                    <Field label="Name" setting="general.name" hint={name ? `The browser tab reads DBackup | ${name}.` : "Empty shows DBackup alone in the browser tab."} error={save.errorOf("instanceName")}>
                        {(id) => (
                            <Input id={id} value={values.instanceName} maxLength={50} placeholder="Like Production" className="max-w-md" onChange={(event) => set("instanceName", event.target.value)} />
                        )}
                    </Field>

                    <Field label="Time zone" setting="general.timezone" hint={`Schedules, file names, the retention and the dashboard follow it. ${zoneExample(values.timezone)}`} error={save.errorOf("timezone")}>
                        {(id) => <TimezoneField id={id} value={values.timezone} onChange={(zone) => set("timezone", zone)} disabled={readOnly} />}
                    </Field>

                    <div className="space-y-2">
                        <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
                            <Field label="Runs at the same time" setting="general.runs">
                                {(id) => (
                                    <NumberStepper
                                        id={id}
                                        value={values.maxConcurrentJobs}
                                        onValueChange={(count) => set("maxConcurrentJobs", count)}
                                        min={1}
                                        max={MAX_RUNS}
                                        decrementLabel="Fewer runs"
                                        incrementLabel="More runs"
                                        disabled={readOnly}
                                    />
                                )}
                            </Field>
                            <Field label="Fail a run that stops reporting after" setting="general.stuck">
                                {(id) => (
                                    <Select value={String(values.stuckTimeoutMinutes)} onValueChange={(minutes) => set("stuckTimeoutMinutes", Number(minutes))} disabled={readOnly}>
                                        <SelectTrigger id={id} className="w-full sm:w-56">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {withSaved(STUCK_CHOICES, values.stuckTimeoutMinutes).map((minutes) => (
                                                <SelectItem key={minutes} value={String(minutes)}>
                                                    {minutesText(minutes)}
                                                    {minutes === 360 ? " (default)" : ""}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </Field>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Backups wait for a free run. A running restore or integrity check takes one too, and so does a run that stopped reporting until it fails. The system task Stuck run watchdog follows this time, Never turns it off.
                        </p>
                    </div>

                    <SwitchList>
                        <div data-setting="general.updates">
                            <SwitchRow
                                title="Look for new versions"
                                description="DBackup asks GitHub for its newest release, shows it in the sidebar and reports it once a day. The system task Check for updates follows this switch."
                                checked={values.checkForUpdates}
                                onCheckedChange={(checked) => set("checkForUpdates", checked)}
                            />
                        </div>
                        <div data-setting="general.quick-setup">
                            <SwitchRow
                                title="Show Quick Setup in the sidebar"
                                description="It shows by itself while no database is set up."
                                checked={values.showQuickSetup}
                                onCheckedChange={(checked) => set("showQuickSetup", checked)}
                            />
                        </div>
                    </SwitchList>
                </fieldset>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, GENERAL_FIELDS)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                }}
                onSave={() => save.run(() => saveGeneralSettingsAction(values), form.commit)}
            />
        </>
    );
}
