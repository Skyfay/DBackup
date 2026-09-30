"use client";

import { updateUserPreferences } from "@/app/actions/auth/user";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { PartFrame, SaveBar, usePartSave, usePartValues } from "@/components/dashboard/settings/settings-frame";
import { changesOf } from "@/components/dashboard/settings/settings-values";
import type { ProfileUser } from "@/services/user/profile-model";

const FIELDS = { autoRedirectOnJobStart: { label: "Open the run" } };

/** What happens after Run now: the page of the run, or a message and the page stays. */
export function RunsPart({ user }: { user: ProfileUser }) {
    const form = usePartValues("runs", { autoRedirectOnJobStart: user.autoRedirectOnJobStart });
    const save = usePartSave("runs");
    const { values, set } = form;

    return (
        <>
            <PartFrame part="runs">
                <SwitchList>
                    <div data-setting="profile.open-run">
                        <SwitchRow
                            title="Open the run"
                            description="After Run now the page of the run opens with its live log. Off, a message says it started and the page stays."
                            checked={values.autoRedirectOnJobStart}
                            onCheckedChange={(checked) => set("autoRedirectOnJobStart", checked)}
                        />
                    </div>
                </SwitchList>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, FIELDS)}
                saving={save.saving}
                onDiscard={form.discard}
                onSave={() => save.run(async () => {
                    const result = await updateUserPreferences(user.id, values);
                    return result.success ? { success: true } : { success: false, error: result.error || "The setting could not be saved." };
                }, form.commit)}
            />
        </>
    );
}
