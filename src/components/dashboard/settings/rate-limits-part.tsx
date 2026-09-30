"use client";

import { Globe, LogIn, PenLine, RotateCcw, type LucideIcon } from "lucide-react";
import { updateRateLimitSettings } from "@/app/actions/settings/rate-limit-settings";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { RATE_LIMIT_DEFAULTS } from "@/lib/rate-limit";
import type { RateLimitConfig } from "@/services/system/settings-types";
import { PartFrame, SaveBar, useSettingsFrame, usePartSave, usePartValues } from "./settings-frame";
import { changesOf } from "./settings-values";

type Kind = keyof RateLimitConfig;

/** "5 per minute" or "100 per 30 seconds". */
export function limitText(limit: { points: number; duration: number }): string {
    return `${limit.points} per ${limit.duration === 60 ? "minute" : `${limit.duration} seconds`}`;
}

export const RATE_LIMIT_FIELDS = {
    auth: { label: "Sign-ins", show: limitText },
    api: { label: "Reads through the API", show: limitText },
    mutation: { label: "Changes through the API", show: limitText },
} as const;

const LIMITS: { kind: Kind; icon: LucideIcon; text: string; maxPoints: number }[] = [
    { kind: "auth", icon: LogIn, text: "Slows down guessing passwords on the login page.", maxPoints: 1000 },
    { kind: "api", icon: Globe, text: "Every GET to /api, from the browser and from API keys.", maxPoints: 10000 },
    { kind: "mutation", icon: PenLine, text: "Every POST, PUT and DELETE to /api.", maxPoints: 1000 },
];

const DEFAULTS: RateLimitConfig = {
    auth: { ...RATE_LIMIT_DEFAULTS.auth },
    api: { ...RATE_LIMIT_DEFAULTS.api },
    mutation: { ...RATE_LIMIT_DEFAULTS.mutation },
};

/** Each limit as a sentence with two numbers and its default beside it. */
export function RateLimitsPart({ saved }: { saved: RateLimitConfig }) {
    const { readOnly } = useSettingsFrame();
    const form = usePartValues("rate-limits", saved);
    const save = usePartSave("rate-limits");
    const { values, set } = form;
    const atDefaults = JSON.stringify(values) === JSON.stringify(DEFAULTS);

    return (
        <>
            <PartFrame
                part="rate-limits"
                action={!readOnly && (
                    <Button variant="outline" size="sm" onClick={() => form.replace(DEFAULTS)} disabled={atDefaults}>
                        <RotateCcw />
                        Reset to defaults
                    </Button>
                )}
            >
                <fieldset disabled={readOnly} className="min-w-0 space-y-3">
                    {LIMITS.map(({ kind, icon: Icon, text, maxPoints }) => (
                        <div key={kind} data-setting={`rate.${kind}`} className="rounded-xl border p-4">
                            <div className="flex items-start gap-3">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                    <Icon className="size-4 text-muted-foreground" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold">{RATE_LIMIT_FIELDS[kind].label}</p>
                                    <p className="text-xs text-muted-foreground">{text}</p>
                                </div>
                                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">Default {limitText(DEFAULTS[kind])}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                                <NumberStepper
                                    value={values[kind].points}
                                    onValueChange={(points) => set(kind, { ...values[kind], points })}
                                    min={1}
                                    max={maxPoints}
                                    aria-label={`${RATE_LIMIT_FIELDS[kind].label}, requests`}
                                    decrementLabel="Fewer requests"
                                    incrementLabel="More requests"
                                    disabled={readOnly}
                                />
                                <span>requests every</span>
                                <NumberStepper
                                    value={values[kind].duration}
                                    onValueChange={(duration) => set(kind, { ...values[kind], duration })}
                                    min={10}
                                    max={3600}
                                    step={10}
                                    aria-label={`${RATE_LIMIT_FIELDS[kind].label}, window in seconds`}
                                    decrementLabel="A shorter window"
                                    incrementLabel="A longer window"
                                    disabled={readOnly}
                                />
                                <span>seconds per address</span>
                            </div>
                        </div>
                    ))}
                </fieldset>
                <p className="text-xs text-muted-foreground">
                    A change applies within 30 seconds. Over the limit DBackup answers 429 Too Many Requests until the window is over.
                </p>
            </PartFrame>
            <SaveBar
                changes={changesOf(form.base, values, RATE_LIMIT_FIELDS)}
                saving={save.saving}
                onDiscard={form.discard}
                onSave={() => save.run(() => updateRateLimitSettings(values), form.commit)}
            />
        </>
    );
}
