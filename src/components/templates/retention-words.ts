import type { RetentionConfiguration, RetentionMode } from "@/lib/core/retention";

/** What each way of keeping backups is called, in the words of the policy dialog. */
export const RETENTION_MODES: Record<RetentionMode, string> = {
    NONE: "Everything",
    SIMPLE: "The last few",
    SMART: "Smart rotation",
};

/** The tiers of a smart policy, finest first, with what each keeps one of. */
export const RETENTION_TIERS = [
    { key: "hourly", label: "Hourly", unit: "hour" },
    { key: "daily", label: "Daily", unit: "day" },
    { key: "weekly", label: "Weekly", unit: "week" },
    { key: "monthly", label: "Monthly", unit: "month" },
    { key: "yearly", label: "Yearly", unit: "year" },
] as const;

/** What a policy keeps, in a few words: "Keeps the last 14" or "7 daily, 4 weekly, 12 monthly". */
export function describeConfig(config: RetentionConfiguration): string {
    if (config.mode === "SIMPLE" && config.simple) return `Keeps the last ${config.simple.keepCount}`;
    if (config.mode === "SMART" && config.smart) {
        const smart = config.smart;
        const tiers = RETENTION_TIERS.filter((tier) => (smart[tier.key] ?? 0) > 0).map((tier) => `${smart[tier.key]} ${tier.label.toLowerCase()}`);
        return tiers.length > 0 ? tiers.join(", ") : "Smart, without a tier";
    }
    return "Keeps everything";
}

/** What a policy keeps, to go into a sentence: "the last 14", "7 daily, 4 weekly and 2 yearly" or "every backup". */
export function keepsPhrase(config: RetentionConfiguration): string {
    if (config.mode === "SIMPLE" && config.simple) return `the last ${config.simple.keepCount}`;
    if (config.mode === "SMART" && config.smart) {
        const smart = config.smart;
        const tiers = RETENTION_TIERS.filter((tier) => (smart[tier.key] ?? 0) > 0).map((tier) => `${smart[tier.key]} ${tier.label.toLowerCase()}`);
        if (tiers.length === 0) return "no backup";
        return tiers.length === 1 ? tiers[0] : `${tiers.slice(0, -1).join(", ")} and ${tiers[tiers.length - 1]}`;
    }
    return "every backup";
}

/** The same for a policy stored as JSON. */
export function describeRetention(config: string): string {
    try {
        return describeConfig(JSON.parse(config) as RetentionConfiguration);
    } catch {
        // A policy that cannot be read keeps everything, like the retention step does.
        return "Keeps everything";
    }
}
