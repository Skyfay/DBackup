import type { AdapterConfig } from "./types";

export interface SplitGroup {
    /** Null when the list needs no heading at all. */
    label: string | null;
    items: AdapterConfig[];
}

const needsAttention = (config: AdapterConfig) => config.lastStatus === "OFFLINE" || config.lastStatus === "DEGRADED";

/**
 * The list of the split view: problems first under their own heading, the rest after them
 * in the order the table would show. Without problems the list needs no headings.
 */
export function splitGroups(configs: AdapterConfig[], withHealth: boolean): SplitGroup[] {
    const issues = withHealth ? configs.filter(needsAttention) : [];
    if (issues.length === 0) return [{ label: null, items: configs }];
    const rest = configs.filter((config) => !needsAttention(config));
    return [
        { label: "Needs attention", items: issues },
        ...(rest.length > 0 ? [{ label: "Everything else", items: rest }] : []),
    ];
}

/** The picked connection while it is still listed, otherwise the first one shown. */
export function resolveSelection(groups: SplitGroup[], selectedId: string | null): AdapterConfig | null {
    const listed = groups.flatMap((group) => group.items);
    return listed.find((config) => config.id === selectedId) ?? listed[0] ?? null;
}
