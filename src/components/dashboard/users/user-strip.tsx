"use client";

import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { listWords } from "@/lib/auth/access-summary";
import type { UsersModel } from "@/services/user/users-types";

/** "Sara Nguyen", "Jana Keller and Sara Nguyen", "Jana Keller and 2 more". */
export function listed(names: string[]): string {
    return names.length <= 2 ? listWords(names) : `${names[0]} and ${names.length - 1} more`;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The numbers above the users: who has no group, who signs in with a password alone, who never signed in. */
export function UsersStrip({ model }: { model: UsersModel | null }) {
    const stats = model?.stats;
    const withoutGroup = stats?.withoutGroup ?? [];
    const passwordOnly = stats?.passwordOnly ?? [];
    const never = stats?.never ?? [];
    return (
        <ExplorerStrip joined
            cells={[
                {
                    label: "Users",
                    value: stats ? stats.users.toLocaleString() : "-",
                    extra: stats ? `${stats.inGroup.toLocaleString()} in a group` : " ",
                },
                {
                    label: "Without a group",
                    value: stats ? withoutGroup.length.toLocaleString() : "-",
                    tone: withoutGroup.length > 0 ? "warning" : undefined,
                    extra: withoutGroup.length > 0
                        ? `${listed(withoutGroup)} ${plural(withoutGroup.length, "can sign in but sees", "can sign in but see")} nothing`
                        : "everyone has a group",
                },
                {
                    label: "Second factor",
                    value: stats ? stats.protected.toLocaleString() : "-",
                    unit: stats ? `of ${stats.users.toLocaleString()}` : undefined,
                    extra: passwordOnly.length > 0
                        ? `${listed(passwordOnly)} ${plural(passwordOnly.length, "uses", "use")} a password only`
                        : "nobody signs in with a password alone",
                },
                {
                    label: "Signed in",
                    value: stats ? stats.signedIn.toLocaleString() : "-",
                    unit: "in 30 days",
                    extra: never.length > 0 ? `${listed(never)} never` : "everyone at least once",
                },
                {
                    label: "Sessions",
                    value: stats ? stats.sessions.toLocaleString() : "-",
                    unit: "open",
                    extra: stats && stats.sessions > 0 ? `in ${stats.devices.toLocaleString()} ${plural(stats.devices, "browser", "browsers")}` : "no browser signed in",
                },
            ]}
        />
    );
}
