import type { RetentionConfiguration } from "@/lib/core/retention";

/** What a policy keeps, in a few words: "Keeps the last 14" or "7 daily, 4 weekly, 12 monthly". */
export function describeRetention(config: string): string {
    try {
        const parsed = JSON.parse(config) as RetentionConfiguration;
        if (parsed.mode === "SIMPLE" && parsed.simple) return `Keeps the last ${parsed.simple.keepCount}`;
        if (parsed.mode === "SMART" && parsed.smart) {
            const { hourly, daily, weekly, monthly, yearly } = parsed.smart;
            const tiers = (
                [
                    [hourly, "hourly"],
                    [daily, "daily"],
                    [weekly, "weekly"],
                    [monthly, "monthly"],
                    [yearly, "yearly"],
                ] as const
            )
                .filter(([count]) => typeof count === "number" && count > 0)
                .map(([count, name]) => `${count} ${name}`);
            return tiers.length > 0 ? tiers.join(", ") : "Smart, without a tier";
        }
    } catch {
        // A policy that cannot be read keeps everything, like the retention step does.
    }
    return "Keeps everything";
}
