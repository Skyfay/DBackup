"use client";

import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { listed } from "@/components/dashboard/users/user-strip";
import type { ApiKeysModel } from "@/services/auth/api-keys-types";

/** The numbers above the keys: which run out soon, which were never used, which do more than read, and whose they are. */
export function ApiKeysStrip({ model }: { model: ApiKeysModel | null }) {
    const stats = model?.stats;
    const parts = stats
        ? [`${stats.working} active`, ...(stats.disabled > 0 ? [`${stats.disabled} disabled`] : []), ...(stats.expired > 0 ? [`${stats.expired} expired`] : [])]
        : [];
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Keys", value: stats ? stats.keys.toLocaleString() : "-", extra: stats ? (stats.keys === 0 ? "none yet" : parts.join(", ")) : " " },
                {
                    label: "Run out soon",
                    value: stats ? stats.soon.length.toLocaleString() : "-",
                    tone: stats && stats.soon.length > 0 ? "warning" : undefined,
                    extra: stats && stats.soon.length > 0 ? `${listed(stats.soon)} within two weeks` : "none within two weeks",
                },
                {
                    label: "Never used",
                    value: stats ? stats.never.length.toLocaleString() : "-",
                    extra: stats && stats.never.length > 0 ? listed(stats.never) : "every key was used",
                },
                {
                    label: "More than reading",
                    value: stats ? stats.beyondReading.length.toLocaleString() : "-",
                    unit: stats ? (stats.beyondReading.length === 1 ? "key" : "keys") : undefined,
                    extra: stats && stats.beyondReading.length > 0 ? listed(stats.beyondReading) : "every key only reads",
                },
                {
                    label: "Owners",
                    value: stats ? stats.owners.length.toLocaleString() : "-",
                    extra: stats && stats.owners.length > 0 ? listed(stats.owners) : " ",
                },
            ]}
        />
    );
}
