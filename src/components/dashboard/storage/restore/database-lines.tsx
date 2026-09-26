"use client";

import { Database } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { lineGroups, type DbFilter, type DbRow, type LineGroup } from "./restore-model";
import { LinesView, NameChips, type Line } from "./restore-lines";
import { OutcomeTag } from "./restore-parts";

function Title({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-sm font-semibold">{children}</span>
            {meta && <span className="truncate text-xs text-muted-foreground">{meta}</span>}
        </span>
    );
}

function bytes(rows: DbRow[], pick: (row: DbRow) => number | null): string | null {
    const known = rows.map(pick).filter((value): value is number => value !== null);
    return known.length > 0 ? formatBytes(known.reduce((sum, value) => sum + value, 0)) : null;
}

/** One group of the lines view as a line: a bundle of many shares one thick line, a single database has a thin one. */
function lineOf(group: LineGroup, onOpen: (filter: DbFilter) => void): Line {
    const { rows } = group;
    const one = rows.length === 1 ? rows[0] : null;
    const size = bytes(rows, (row) => row.size);
    const names = rows.map((row) => row.source ?? row.target);
    const left = one ? (
        <Title meta={size ?? undefined}>{one.source}</Title>
    ) : (
        <>
            <Title meta={[group.outcome === "out" ? null : "under their own names", size].filter(Boolean).join(" · ")}>{rows.length} databases</Title>
            <NameChips names={names} />
        </>
    );
    // A heavier line for a larger bundle, up to twelve pixels.
    const weight = Math.min(2.5 + rows.length, 12);

    if (group.key === "out") {
        return {
            key: group.key, tone: null, label: "stays out", dim: true, onOpen: () => onOpen("out"),
            left: one ? <Title meta={size ?? undefined}>{one.source}</Title> : <><Title>{rows.length} stay out</Title><NameChips names={names} /></>,
            right: <span className="text-sm text-muted-foreground">Not restored</span>,
        };
    }
    if (group.renamed && one) {
        const overwrites = one.outcome === "overwrite";
        return {
            key: group.key, tone: overwrites ? "warning" : "success", dashed: !overwrites, label: "new name", onOpen: () => onOpen(overwrites ? "overwrite" : "new"),
            left,
            right: (
                <span className="flex items-center justify-between gap-3">
                    <Title meta={overwrites ? "overwrites the one there" : `a copy of ${one.source}`}>{one.target}</Title>
                    {overwrites ? <OutcomeTag tone="warning" icon="alert">Overwritten</OutcomeTag> : <OutcomeTag tone="success" icon="plus">New</OutcomeTag>}
                </span>
            ),
        };
    }
    if (group.outcome === "overwrite") {
        const there = bytes(rows, (row) => row.thereSize);
        return {
            key: group.key, tone: "warning", weight, stacked: !one, label: one ? "overwrites" : `${rows.length} overwrite their namesakes`, onOpen: () => onOpen("overwrite"),
            left,
            right: (
                <>
                    <span className="flex items-center justify-between gap-3">
                        <Title meta={there ? `${there} there now` : undefined}>{one ? one.target : `${rows.length} overwritten`}</Title>
                        <OutcomeTag tone="warning" icon="alert">Overwritten</OutcomeTag>
                    </span>
                    {!one && <NameChips names={names} />}
                </>
            ),
        };
    }
    const unverified = group.outcome === "unverified";
    return {
        key: group.key, tone: unverified ? "muted" : "success", dashed: true, weight: unverified ? 2.5 : weight, stacked: !one,
        label: unverified ? "not checked" : one ? "new" : `${rows.length} new`, onOpen: () => onOpen("new"),
        left,
        right: (
            <>
                <span className="flex items-center justify-between gap-3">
                    <Title>{one ? one.target : `${rows.length} new`}</Title>
                    {unverified ? <OutcomeTag tone="muted" icon="help">Not checked</OutcomeTag> : <OutcomeTag tone="success" icon="plus">New</OutcomeTag>}
                </span>
                {!one && <NameChips names={names} />}
            </>
        ),
    };
}

/**
 * The databases as lines from the backup to the server. Databases that do the same under their own
 * names share one bundle, so a backup with many stays as short as one with few. A click on a
 * bundle opens its rows in the table.
 */
export function DatabaseLines({ rows, serverName, onOpen }: { rows: DbRow[]; serverName: string | null; onOpen: (filter: DbFilter) => void }) {
    const lines = lineGroups(rows).map((group) => lineOf(group, onOpen));
    const staying = rows.filter((row) => row.outcome === "stays").length;
    if (lines.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">The backup holds no database.</p>;
    return <LinesView lines={lines} foot={staying > 0 ? `${staying} other${staying === 1 ? "" : "s"} on ${serverName ?? "the server"} stay as they are` : undefined} />;
}
