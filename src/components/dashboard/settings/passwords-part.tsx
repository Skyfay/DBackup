"use client";

import { useId, useMemo, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { savePasswordSettingsAction } from "@/app/actions/settings/settings";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    GENERATED_LENGTH,
    GENERATED_SPECIALS,
    LEVEL_NAMES,
    MAX_PASSWORD_LENGTH,
    MAX_SPECIAL_CHARACTERS,
    MIN_PASSWORD_LENGTH,
    PASSWORD_LEVELS,
    describePolicy,
    generatePassword,
    policyOf,
    type PasswordLevel,
    type PasswordPolicy,
    type PasswordRules,
} from "@/lib/auth/password-policy";
import { Field, PartFrame, SaveBar, useSettingsFrame, usePartSave, usePartValues, type PartChange } from "./settings-frame";
import { changesOf } from "./settings-values";

const RULE_FIELDS = {
    minLength: { label: "Minimum length", show: (length: number) => `${length} characters` },
    upper: { label: "Upper case letters" },
    lower: { label: "Lower case letters" },
    digits: { label: "Numbers" },
    special: { label: "Special characters", show: (count: number) => (count > 0 ? `at least ${count}` : "off") },
    notName: { label: "Not the name or the email" },
} as const;

/** What the save bar names: the level, and the rules one by one only for Custom, since a level stands for its rules. */
export function passwordChanges(before: PasswordPolicy, after: PasswordPolicy): PartChange[] {
    const level = before.level === after.level ? [] : [{ label: "Strength", from: LEVEL_NAMES[before.level], to: LEVEL_NAMES[after.level] }];
    return after.level === "custom" ? [...level, ...changesOf(before, after, RULE_FIELDS)] : level;
}

/**
 * How strong a new password has to be: a level on top that fills in the rules below, and changing
 * a rule makes it Custom. Under them the rules in one sentence with a password Generate would make.
 */
export function PasswordsPart({ saved }: { saved: PasswordPolicy }) {
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("passwords", saved);
    const save = usePartSave("passwords");
    const { values, replace } = form;
    const levelId = useId();
    const [round, setRound] = useState(0);
    const rules = JSON.stringify(policyOf("custom", values));
    // A new example for other rules and for every click on Show another, never while typing elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const example = useMemo(() => generatePassword(values), [rules, round]);

    const change = <K extends keyof PasswordRules>(key: K, value: PasswordRules[K]) =>
        replace((current) => ({ ...current, [key]: value, level: "custom" as const }));
    const pickLevel = (level: PasswordLevel) => replace((current) => policyOf(level, current));

    return (
        <>
            <PartFrame part="passwords">
                <fieldset disabled={readOnly} className="min-w-0 space-y-6">
                    <div data-setting="passwords.level" className="flex flex-col gap-3 rounded-lg sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                            <p id={levelId} className="text-sm font-medium">Strength</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">A level fills in the rules below. Changing one makes it Custom.</p>
                        </div>
                        <Tabs value={values.level} onValueChange={(level) => pickLevel(level as PasswordLevel)}>
                            <TabsList className="h-8" aria-labelledby={levelId}>
                                {PASSWORD_LEVELS.map((level) => (
                                    <TabsTrigger key={level} value={level} className="px-2.5 text-xs">{LEVEL_NAMES[level]}</TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>

                    <Field
                        label="Minimum length"
                        setting="passwords.length"
                        hint={`From ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH}. Generate makes ${GENERATED_LENGTH} characters, or the minimum when it is longer.`}
                        error={save.errorOf("minLength")}
                    >
                        {(id) => (
                            <NumberStepper
                                id={id}
                                value={values.minLength}
                                onValueChange={(length) => change("minLength", length)}
                                min={MIN_PASSWORD_LENGTH}
                                max={MAX_PASSWORD_LENGTH}
                                decrementLabel="Shorter"
                                incrementLabel="Longer"
                            />
                        )}
                    </Field>

                    <div className="space-y-2">
                        <p className="text-sm font-medium">What it needs</p>
                        <SwitchList>
                            <div data-setting="passwords.upper">
                                <SwitchRow title="Upper case letters" description="At least one from A to Z." checked={values.upper} onCheckedChange={(on) => change("upper", on)} />
                            </div>
                            <div data-setting="passwords.lower">
                                <SwitchRow title="Lower case letters" description="At least one from a to z." checked={values.lower} onCheckedChange={(on) => change("lower", on)} />
                            </div>
                            <div data-setting="passwords.digits">
                                <SwitchRow title="Numbers" description="At least one from 0 to 9." checked={values.digits} onCheckedChange={(on) => change("digits", on)} />
                            </div>
                            <div data-setting="passwords.special">
                                <SwitchRow
                                    title="Special characters"
                                    description={
                                        <>
                                            Every character but a letter, a number or a space counts. Generate uses{" "}
                                            <code className="font-mono text-[11px]">{GENERATED_SPECIALS.split("").join(" ")}</code> only.
                                        </>
                                    }
                                    checked={values.special > 0}
                                    onCheckedChange={(on) => change("special", on ? 1 : 0)}
                                    aside={values.special > 0 && (
                                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                                            at least
                                            <NumberStepper
                                                value={values.special}
                                                onValueChange={(count) => change("special", count)}
                                                min={1}
                                                max={MAX_SPECIAL_CHARACTERS}
                                                className="h-8"
                                                aria-label="How many special characters"
                                                decrementLabel="Fewer"
                                                incrementLabel="More"
                                            />
                                        </span>
                                    )}
                                />
                            </div>
                            <div data-setting="passwords.name">
                                <SwitchRow
                                    title="Not the name or the email"
                                    description="Neither the name nor the part of the email before the @ may stand in it."
                                    checked={values.notName}
                                    onCheckedChange={(on) => change("notName", on)}
                                />
                            </div>
                        </SwitchList>
                    </div>
                </fieldset>

                <div className="flex gap-3 rounded-lg border bg-muted/40 px-4 py-3.5">
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1 space-y-2.5">
                        <p className="text-sm">{describePolicy(values)}</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Generate makes ones like</span>
                            <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{example}</code>
                            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Show another" onClick={() => setRound((count) => count + 1)}>
                                <RefreshCw />
                            </Button>
                        </div>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">Passwords that are set stay valid. The rules apply from their next change, and to every new user.</p>
            </PartFrame>
            <SaveBar
                changes={passwordChanges(form.base, values)}
                saving={save.saving}
                onDiscard={() => {
                    form.discard();
                    save.clearProblem();
                }}
                onSave={() => save.run(() => savePasswordSettingsAction(values), form.commit)}
            />
        </>
    );
}
