"use client";

import { useId } from "react";
import { ChoiceCards, type ModeOption } from "@/components/adapter/connection-mode-choice";
import { RETENTION_TIERS } from "@/components/templates/retention-words";
import { NumberStepper } from "@/components/ui/number-stepper";
import type { RetentionConfiguration, RetentionMode, SmartRetentionPolicy } from "@/lib/core/retention";
import { mostKept } from "@/services/templates/retention-preview";

const DEFAULT_SIMPLE = { keepCount: 10 };
const DEFAULT_SMART: SmartRetentionPolicy = { hourly: 0, daily: 7, weekly: 4, monthly: 12, yearly: 2 };
/** More than anyone keeps, and few enough that a typo cannot switch retention off. */
const MOST = 1000;

const MODES: ModeOption[] = [
    { value: "NONE", title: "Everything", description: "Never removes a backup." },
    { value: "SIMPLE", title: "The last few", description: "Keeps the newest ones, however old." },
    { value: "SMART", title: "Smart rotation", description: "One a day, a week, a month and a year." },
];

interface TierRowProps {
    label: string;
    sub: string;
    value: number;
    min: number;
    /** What it was before this change, said beside it while it differs. */
    was?: number;
    onChange: (value: number) => void;
}

function TierRow({ label, sub, value, min, was, onChange }: TierRowProps) {
    const changed = was !== undefined && was !== value;
    return (
        <div className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="truncate text-xs text-muted-foreground">
                    {sub}
                    {changed && `, was ${was}`}
                </p>
            </div>
            <NumberStepper
                value={value}
                onValueChange={onChange}
                min={min}
                max={MOST}
                aria-label={label}
                decrementLabel={`Fewer ${label.toLowerCase()}`}
                incrementLabel={`More ${label.toLowerCase()}`}
                className="shrink-0"
            />
        </div>
    );
}

interface Props {
    value: RetentionConfiguration;
    onChange: (config: RetentionConfiguration) => void;
    /** The policy as saved, so a changed number says what it was. */
    saved?: RetentionConfiguration;
}

/**
 * What a retention policy keeps: everything, the newest few, or a smart rotation with a number per
 * tier. The picked card and the steppers take the tone of the dialog around them.
 */
export function RetentionPolicyForm({ value, onChange, saved }: Props) {
    const labelId = useId();
    const simple = value.simple ?? DEFAULT_SIMPLE;
    const smart = value.smart ?? DEFAULT_SMART;
    const most = mostKept({ ...value, simple, smart });

    const setMode = (mode: string) => onChange({ mode: mode as RetentionMode, simple, smart });
    const setTier = (key: keyof SmartRetentionPolicy, count: number) => onChange({ ...value, simple, smart: { ...smart, [key]: count } });

    return (
        <div className="space-y-3">
            <p id={labelId} className="text-sm font-medium">What it keeps</p>
            <ChoiceCards value={value.mode} onValueChange={setMode} options={MODES} aria-labelledby={labelId} className="sm:grid-cols-3" />

            {value.mode === "SIMPLE" && (
                <div className="rounded-lg border">
                    <TierRow
                        label="Backups"
                        sub="the newest ones a destination keeps"
                        value={simple.keepCount}
                        min={1}
                        was={saved?.mode === "SIMPLE" ? saved.simple?.keepCount : undefined}
                        onChange={(keepCount) => onChange({ ...value, smart, simple: { keepCount } })}
                    />
                </div>
            )}

            {value.mode === "SMART" && (
                <div className="divide-y rounded-lg border">
                    {RETENTION_TIERS.map((tier) => (
                        <TierRow
                            key={tier.key}
                            label={tier.label}
                            sub={`the newest of each ${tier.unit}`}
                            value={smart[tier.key] ?? 0}
                            min={0}
                            was={saved?.mode === "SMART" ? (saved.smart?.[tier.key] ?? 0) : undefined}
                            onChange={(count) => setTier(tier.key, count)}
                        />
                    ))}
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                {value.mode === "NONE" || most === null
                    ? "Every backup stays, so the storage grows with every run."
                    : `At most ${most.toLocaleString()} backups a destination. Locked backups always stay.`}
            </p>
        </div>
    );
}
