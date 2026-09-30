"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { saveProfileDatesAction } from "@/app/actions/auth/profile";
import { Field, PartFrame, SaveBar, usePartSave, usePartValues } from "@/components/dashboard/settings/settings-frame";
import { changesOf } from "@/components/dashboard/settings/settings-values";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { authClient } from "@/lib/auth/client";
import { DATE_FORMATS, TIME_FORMATS } from "@/lib/core/profile-formats";
import type { ProfileUser } from "@/services/user/profile-model";
import { ProfileTimezoneField } from "./profile-timezone-field";

/** Now in a zone and a pattern, the zone of the browser for an empty one. A literal pattern, so it shows exactly that format. */
function sample(zone: string, pattern: string, at: Date): string {
    return zone ? formatInTimeZone(at, zone, pattern) : format(at, pattern);
}

/** The time zone and the formats every date and time of the dashboard follows for the viewer. */
export function DatesPart({ user }: { user: ProfileUser }) {
    const { refetch } = authClient.useSession();
    const form = usePartValues("dates", { timezone: user.timezone, dateFormat: user.dateFormat, timeFormat: user.timeFormat });
    const save = usePartSave("dates");
    const { values, set } = form;
    const now = useMemo(() => new Date(), []);

    const fields = useMemo(() => ({
        timezone: { label: "Time zone", show: (zone: string) => zone || "This browser" },
        dateFormat: { label: "Date", show: (pattern: string) => sample(values.timezone, pattern, now) },
        timeFormat: { label: "Time", show: (pattern: string) => sample(values.timezone, pattern, now) },
    }), [values.timezone, now]);

    return (
        <>
            <PartFrame part="dates">
                <Field label="Time zone" setting="profile.timezone" hint="Every date and time follows it for you. This browser follows the zone the browser is in, like on a trip." error={save.errorOf("timezone")}>
                    {(id) => <ProfileTimezoneField id={id} value={values.timezone} onChange={(zone) => set("timezone", zone)} />}
                </Field>
                <div className="grid max-w-xl gap-6 sm:grid-cols-2">
                    <Field label="Date" setting="profile.date" error={save.errorOf("dateFormat")}>
                        {(id) => (
                            <Select value={values.dateFormat} onValueChange={(pattern) => set("dateFormat", pattern)}>
                                <SelectTrigger id={id} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {DATE_FORMATS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {sample(values.timezone, option.value, now)}
                                            <span className="text-muted-foreground">{option.label}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </Field>
                    <Field label="Time" setting="profile.time" error={save.errorOf("timeFormat")}>
                        {(id) => (
                            <Select value={values.timeFormat} onValueChange={(pattern) => set("timeFormat", pattern)}>
                                <SelectTrigger id={id} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TIME_FORMATS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {sample(values.timezone, option.value, now)}
                                            <span className="text-muted-foreground">{option.label}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                    A backup made now reads {sample(values.timezone, `${values.dateFormat} ${values.timeFormat}`, now)} for you. The schedules run on the time zone under Settings, General.
                </p>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, fields)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                }}
                onSave={() => save.run(() => saveProfileDatesAction(values), () => {
                    form.commit();
                    // Every date of the dashboard reads the formats from the session.
                    void refetch();
                })}
            />
        </>
    );
}
