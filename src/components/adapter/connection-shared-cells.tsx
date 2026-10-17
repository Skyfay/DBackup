"use client";

import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { connectionVersion } from "@/lib/adapters/connection-summary";
import { cn } from "@/lib/utils";
import type { ListedDatabases } from "@/services/adapters/connection-databases";
import type { SharedServerTerms } from "@/services/sharing/shared-server-rows";
import { Muted } from "./connection-cells";
import type { AdapterConfig } from "./types";

/**
 * The cells of a server of another tenant in the list of databases, one row per server like an own
 * connection, with the databases of it the tenant got. Its provider runs the server and backs them
 * up, so the row tells whose job does that and how their backups went.
 */

/** "2 databases yours", or "1 database yours". */
export function databasesYours(count: number): string {
    return `${count.toLocaleString()} ${count === 1 ? "database" : "databases"} yours`;
}

/** "acme_shop, acme_crm", and from three on "acme_shop, acme_crm and 10 more". */
export function databaseNames(names: readonly string[], total = names.length): string {
    const shown = names.slice(0, 2).join(", ");
    return total > 2 ? `${shown} and ${(total - 2).toLocaleString()} more` : shown;
}

/** How the tenant got them: by name, or by the patterns of the provider's rules, which give a new one too. */
export function givenText(terms: Pick<SharedServerTerms, "rules">): string {
    if (terms.rules.length === 0) return "given to you";
    return `every ${terms.rules.map((rule) => rule.pattern).join(" or ")} database`;
}

/** "MySQL 8.0 · 2 databases yours", the line under the name of a provided server. */
export function sharedKindLine(config: Pick<AdapterConfig, "metadata">, terms: Pick<SharedServerTerms, "databases">, kind: string): string {
    const version = connectionVersion(config.metadata);
    return `${kind}${version ? ` ${version}` : ""} · ${databasesYours(terms.databases.length)}`;
}

/** "every day at 02:00", the schedule of the provider's job in words that go inside a sentence. */
export function scheduleText(schedule: string | null): string | null {
    if (!schedule) return null;
    const words = describeSchedule(schedule);
    return words.described ? words.text.charAt(0).toLowerCase() + words.text.slice(1) : `on the schedule ${words.text}`;
}

function TwoLines({ first, second }: { first: string; second: string }) {
    return (
        <span className="block min-w-0 max-w-64">
            <span className="block truncate text-sm" title={first}>{first}</span>
            <span className="block truncate text-xs text-muted-foreground" title={second}>{second}</span>
        </span>
    );
}

/** The databases of a provided server the tenant got, and how it got them. */
export function SharedDatabasesCell({ terms }: { terms: SharedServerTerms }) {
    const names = terms.databases.map(({ database }) => database.databaseName);
    return <TwoLines first={databaseNames(names)} second={givenText(terms)} />;
}

/** How many databases an own server held at its last read, and the first of them. Empty before the first read. */
export function ListedDatabasesCell({ listed }: { listed: ListedDatabases | null | undefined }) {
    if (!listed) return <Muted>-</Muted>;
    if (listed.count === 0) return <Muted>None</Muted>;
    return <TwoLines first={`${listed.count.toLocaleString()} ${listed.count === 1 ? "database" : "databases"}`} second={databaseNames(listed.names, listed.count)} />;
}

/** Who backs them up, the provider with the schedule of its job. */
export function SharedBackedUpByCell({ terms }: { terms: SharedServerTerms }) {
    const schedule = scheduleText(terms.schedule);
    return <TwoLines first={terms.providerName} second={schedule ? `their job, ${schedule}` : "no schedule of theirs"} />;
}

/** The newest backup of its databases and how many the tenant has, like the size and count of a destination. */
export function SharedLastBackupCell({ terms }: { terms: Pick<SharedServerTerms, "lastBackup" | "backups"> }) {
    const last = terms.lastBackup;
    if (!last) return <Muted>None yet</Muted>;
    return (
        <span className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
            <span className={cn("size-1.5 shrink-0 rounded-full", last.passed === false ? "bg-destructive" : "bg-success")} aria-hidden="true" />
            <RelativeTime date={last.at} />
            {last.passed === false && <span className="sr-only">, its check failed</span>}
            <span className="text-xs text-muted-foreground tabular-nums">
                {terms.backups.toLocaleString()} backup{terms.backups === 1 ? "" : "s"}
            </span>
        </span>
    );
}
