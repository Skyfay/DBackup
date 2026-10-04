"use client";

import { FileJson } from "lucide-react";
import { savePrivacySettingsAction } from "@/app/actions/settings/privacy-settings";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { CodeBlock } from "@/components/ui/code-block";
import type { PrivacySettings } from "@/services/system/settings-types";
import { PartFrame, SaveBar, useSettingsFrame, usePartSave, usePartValues } from "./settings-frame";
import { changesOf } from "./settings-values";

export const PRIVACY_FIELDS = {
    includeActorInMetadata: { label: "Name who started a backup in its metadata" },
} as const;

/** The part of a `.meta.json` that the switch changes, with the name of the viewer as the example. */
export function triggerSample(includeActor: boolean, actor: string): string {
    return includeActor
        ? `"trigger": {\n  "type": "Manual",\n  "actor": ${JSON.stringify(actor)}\n}`
        : `"trigger": {\n  "type": "Manual"\n}`;
}

/** Whether the metadata beside a backup names who started it, with that part of the file as it comes out. */
export function PrivacyPart({ saved, viewerName }: { saved: PrivacySettings; viewerName: string }) {
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("privacy", saved);
    const save = usePartSave("privacy");
    const { values, set } = form;
    // The tokens of the code are marked one at a time, so the mark is the name alone.
    const actor = JSON.stringify(viewerName);

    return (
        <>
            <PartFrame part="privacy">
                <fieldset disabled={readOnly} className="min-w-0" data-setting="privacy.actor">
                    <SwitchList>
                        <SwitchRow
                            title="Name who started a backup in its metadata"
                            description="The person or API key goes into the .meta.json beside each backup. That file is not encrypted, anyone who reads the destination reads it."
                            checked={values.includeActorInMetadata}
                            onCheckedChange={(checked) => set("includeActorInMetadata", checked)}
                        />
                    </SwitchList>
                </fieldset>
                <div className="space-y-2">
                    <CodeBlock
                        name="shop_2026-09-29_03-00-00.tar.meta.json"
                        icon={<FileJson />}
                        code={triggerSample(values.includeActorInMetadata, viewerName)}
                        language="json"
                        mark={values.includeActorInMetadata ? { text: actor, tone: "warning" } : undefined}
                    />
                    <p className="text-xs text-muted-foreground">
                        {values.includeActorInMetadata
                            ? "A backup on its schedule names the Scheduler, one through the API the name of its key."
                            : "Off, the file only says whether a schedule, a person or an API key started the backup."}
                    </p>
                </div>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, PRIVACY_FIELDS)}
                saving={save.saving}
                onDiscard={form.discard}
                onSave={() => save.run(() => savePrivacySettingsAction(values), form.commit)}
            />
        </>
    );
}
