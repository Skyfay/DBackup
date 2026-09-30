"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCog, Loader2, LockKeyhole, Play, Upload } from "lucide-react";
import { toast } from "sonner";
import { saveConfigBackupSettingsAction } from "@/app/actions/backup/config-backup-settings";
import { runSystemTaskAction } from "@/app/actions/settings/system-tasks";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { ConnectionPicker } from "@/components/dashboard/jobs/connection-picker";
import { EncryptionKeyPicker } from "@/components/dashboard/jobs/encryption-key-picker";
import { NO_ENCRYPTION } from "@/components/dashboard/jobs/job-form-schema";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { SchedulePicker } from "@/components/dashboard/jobs/schedule-picker";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { ConfigBackupSettings, SettingsModel } from "@/services/system/settings-types";
import { ConfigRestoreDialog } from "./config-restore-dialog";
import { Field, PartFrame, SaveBar, useSettingsFrame, usePartSave, usePartValues } from "./settings-frame";
import { changesOf } from "./settings-values";

const log = logger.child({ component: "config-backup-part" });

const TASK_ID = "system.config_backup";
export const MAX_KEPT = 365;

/** The words of the save bar, with the destination and the key by their names. */
function fieldsOf(model: SettingsModel["configBackup"]) {
    const destination = (id: string) => model.destinations.find((entry) => entry.id === id)?.name ?? (id ? "a destination that is gone" : "none");
    const key = (id: string) => model.keys.find((entry) => entry.id === id)?.name ?? (id ? "a key that is gone" : "none");
    const schedule = (cron: string) => describeSchedule(cron)?.text ?? cron;
    return {
        enabled: { label: "Back up the configuration" },
        storageId: { label: "Destination", show: destination },
        profileId: { label: "Encryption key", show: key },
        schedule: { label: "Schedule", show: schedule },
        retention: { label: "Keeps" },
        includeSecrets: { label: "Include the logins" },
        includeStatistics: { label: "Include the history" },
    } satisfies { [K in keyof ConfigBackupSettings]?: { label: string; show?: (value: ConfigBackupSettings[K]) => string } };
}

/** Whether it ran, when and where to, or what went wrong, on top of the part. */
function ConfigStatus({ model, enabled }: { model: SettingsModel["configBackup"]; enabled: boolean }) {
    const { lastRun, running } = model;
    const failed = lastRun && !lastRun.ok;
    const never = !lastRun;
    const warn = !enabled || failed || never;
    return (
        <div className="flex items-start gap-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", warn ? "bg-warning/12 text-warning" : "bg-success/12 text-success")} aria-hidden="true">
                {running ? <Loader2 className="size-5 animate-spin" /> : <FileCog className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                        {running ? "Backing up now" : never ? "Never backed up" : failed ? "The last backup failed" : <>Backed up <RelativeTime date={lastRun.at} /></>}
                    </p>
                    <Badge variant="outline" className={enabled ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}>
                        {enabled ? "On" : "Off"}
                    </Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    {failed
                        ? lastRun.summary ?? "It did not finish."
                        : never || !enabled
                            ? "Without it, a lost server means setting up every connection, job and user again."
                            : lastRun.summary ?? "The file went to its destination."}
                </p>
            </div>
        </div>
    );
}

/** Where the configuration backup goes, the key, the schedule, how many stay and what it holds. */
export function ConfigBackupPart({ model, isSuperAdmin }: { model: SettingsModel["configBackup"]; isSuperAdmin: boolean }) {
    const router = useRouter();
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("config-backup", model.settings);
    const save = usePartSave("config-backup");
    const { values, set } = form;
    // The schedule picker holds what it shows, so a discard mounts it anew.
    const [pickerKey, setPickerKey] = useState(0);
    const [restoring, setRestoring] = useState(false);
    const [starting, setStarting] = useState(false);
    const fields = fieldsOf(model);
    const secretsWithoutKey = values.includeSecrets && !values.profileId;

    const backUpNow = async () => {
        setStarting(true);
        try {
            const result = await runSystemTaskAction(TASK_ID);
            if (!result.success) {
                toast.error(result.error || "The backup could not start.");
                return;
            }
            toast.success("The configuration backup started");
            router.refresh();
        } catch (error: unknown) {
            log.warn("Starting the configuration backup failed", {}, wrapError(error));
            toast.error("The backup could not start.");
        } finally {
            setStarting(false);
        }
    };

    const action = !readOnly && (
        <>
            <Button variant="outline" size="sm" onClick={() => void backUpNow()} disabled={!form.base.enabled || form.dirty || model.running || starting} title={form.base.enabled ? undefined : "Switch it on and save first"}>
                {starting || model.running ? <Loader2 className="animate-spin" /> : <Play />}
                Back up now
            </Button>
            {isSuperAdmin && (
                <Button variant="outline" size="sm" onClick={() => setRestoring(true)} data-setting="config.restore">
                    <Upload />
                    Restore from a file
                </Button>
            )}
        </>
    );

    return (
        <>
            <PartFrame part="config-backup" action={action}>
                <ConfigStatus model={model} enabled={form.base.enabled} />
                <fieldset disabled={readOnly} className="min-w-0 space-y-6">
                    <div data-setting="config.enabled">
                        <SwitchList>
                            <SwitchRow
                                title="Back up the configuration"
                                description="On the schedule below, to the destination below. The system task of the same name follows it."
                                checked={values.enabled}
                                onCheckedChange={(checked) => set("enabled", checked)}
                            />
                        </SwitchList>
                    </div>

                    <Field label="Destination" setting="config.destination" hint="The file goes into the folder config-backups there." error={save.errorOf("storageId")}>
                        {(id) => (
                            <ConnectionPicker
                                id={id}
                                kind="destination"
                                options={model.destinations}
                                value={values.storageId}
                                onChange={(storageId) => set("storageId", storageId)}
                                placeholder="Pick a destination"
                                className="max-w-md"
                            />
                        )}
                    </Field>

                    <Field
                        label="Encryption key"
                        setting="config.key"
                        hint="Needed for the logins. Keep it in a recovery kit, or a lost server takes the key with it."
                        error={save.errorOf("profileId") ?? (secretsWithoutKey ? "The logins go into the file only encrypted. Pick a key or leave them out." : null)}
                    >
                        {(id) => (
                            <EncryptionKeyPicker
                                id={id}
                                keys={model.keys}
                                value={values.profileId || NO_ENCRYPTION}
                                onChange={(profileId) => set("profileId", profileId === NO_ENCRYPTION ? "" : profileId)}
                                className="max-w-md"
                            />
                        )}
                    </Field>

                    <Field label="Schedule" setting="config.schedule" error={save.errorOf("schedule")}>
                        {() => (
                            <div className="max-w-xl">
                                <SchedulePicker key={pickerKey} value={values.schedule} onChange={(schedule) => set("schedule", schedule)} withClashes={false} />
                            </div>
                        )}
                    </Field>

                    <Field label="Keeps" setting="config.keeps" hint="The oldest file goes once there are more." error={save.errorOf("retention")}>
                        {(id) => (
                            <NumberStepper
                                id={id}
                                value={values.retention}
                                onValueChange={(retention) => set("retention", retention)}
                                min={1}
                                max={MAX_KEPT}
                                decrementLabel="Keep fewer"
                                incrementLabel="Keep more"
                                disabled={readOnly}
                            />
                        )}
                    </Field>

                    <SwitchList>
                        <div data-setting="config.secrets">
                            <SwitchRow
                                title="Include the logins"
                                description="The passwords and keys of every connection. Only with an encryption key, and a restore brings them back without typing them again."
                                checked={values.includeSecrets}
                                onCheckedChange={(checked) => set("includeSecrets", checked)}
                            />
                        </div>
                        <div data-setting="config.history">
                            <SwitchRow
                                title="Include the history"
                                description="Runs, logs, the audit log and the storage history. The file gets much bigger."
                                checked={values.includeStatistics}
                                onCheckedChange={(checked) => set("includeStatistics", checked)}
                            />
                        </div>
                    </SwitchList>
                </fieldset>

                {!isSuperAdmin && (
                    <p data-setting="config.restore" className="flex items-center gap-2 text-sm text-muted-foreground">
                        <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
                        Only a SuperAdmin restores a configuration, since it brings back users, groups and sign-in providers.
                    </p>
                )}
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, fields)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                    setPickerKey((key) => key + 1);
                }}
                onSave={() => save.run(() => saveConfigBackupSettingsAction(values), form.commit)}
            />
            {isSuperAdmin && <ConfigRestoreDialog open={restoring} onOpenChange={setRestoring} />}
        </>
    );
}
