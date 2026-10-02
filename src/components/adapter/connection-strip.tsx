"use client";

import { Activity, Archive, Bell, CalendarClock, CircleX, Database, FolderTree, HardDrive, Layers, Send, Timer, type LucideIcon } from "lucide-react";
import { ExplorerStrip, type StripCell } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { namesFor } from "@/lib/core/tab-attention";
import { formatBytes } from "@/lib/utils";
import { kindNames, type ConnectionKind } from "./connection-columns";
import type { AdapterConfig } from "./types";
import { isAirGapped } from "@/lib/core/air-gap";

const KIND: Record<ConnectionKind, { label: string; icon: LucideIcon }> = {
    database: { label: "Databases", icon: Database },
    source: { label: "Sources", icon: FolderTree },
    destination: { label: "Destinations", icon: HardDrive },
    notification: { label: "Channels", icon: Bell },
};

/** "MySQL 2, PostgreSQL, Redis": the types of a list, the most used first. */
function typesOf(configs: AdapterConfig[]): string {
    const counts = new Map<string, number>();
    for (const config of configs) counts.set(config.adapterId, (counts.get(config.adapterId) ?? 0) + 1);
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([adapterId, count]) => `${kindNames.get(adapterId) ?? adapterId}${count > 1 ? ` ${count}` : ""}`)
        .join(", ");
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Whether they answer, like the dot of their status: offline in red, a failed check in amber. An
 * air-gapped destination that is not connected is away on purpose and is not counted.
 */
function answeringCell(configs: AdapterConfig[]): StripCell {
    const status = (config: AdapterConfig) => config.lastStatus ?? "ONLINE";
    const isAway = (config: AdapterConfig) => status(config) !== "ONLINE" && isAirGapped(config);
    const away = configs.filter(isAway).map((config) => config.name);
    const expected = configs.filter((config) => !isAway(config));
    const offline = expected.filter((config) => status(config) === "OFFLINE").map((config) => config.name);
    const degraded = expected.filter((config) => status(config) === "DEGRADED").map((config) => config.name);
    const answering = expected.length - offline.length - degraded.length;
    const trouble = [
        ...(offline.length > 0 ? [`${namesFor(offline)} ${offline.length === 1 ? "does" : "do"} not answer`] : []),
        ...(degraded.length > 0 ? [`${namesFor(degraded)} failed ${degraded.length === 1 ? "its" : "their"} last check`] : []),
    ];
    const awayText = away.length > 0 ? `${namesFor(away)} air-gapped, not connected` : null;
    return {
        label: "Answering",
        icon: Activity,
        value: answering.toLocaleString(),
        unit: `of ${expected.length.toLocaleString()}`,
        tone: offline.length > 0 ? "destructive" : degraded.length > 0 ? "warning" : undefined,
        extra: [trouble.length > 0 ? trouble.join(", ") : "every connection answers", awayText].filter(Boolean).join(", "),
    };
}

function responseCell(configs: AdapterConfig[]): StripCell {
    const timed = configs.filter((config) => typeof config.overview?.latencyMs === "number");
    const slowest = [...timed].sort((a, b) => (b.overview?.latencyMs ?? 0) - (a.overview?.latencyMs ?? 0))[0];
    const middle = median(timed.map((config) => config.overview!.latencyMs!));
    return {
        label: "Response",
        icon: Timer,
        value: middle !== null ? middle.toLocaleString() : "-",
        unit: middle !== null ? "ms" : undefined,
        extra: slowest ? `the median, ${slowest.name} slowest at ${slowest.overview!.latencyMs!.toLocaleString()} ms` : "no check answered yet",
    };
}

function inJobCell(configs: AdapterConfig[]): StripCell {
    const idle = configs.filter((config) => (config.overview?.usedBy.jobs ?? 0) === 0).map((config) => config.name);
    return {
        label: "In a job",
        icon: CalendarClock,
        value: (configs.length - idle.length).toLocaleString(),
        unit: `of ${configs.length.toLocaleString()}`,
        extra: idle.length > 0 ? `${namesFor(idle)} ${idle.length === 1 ? "is" : "are"} in no job` : "every connection is in a job",
    };
}

function lastBackupCell(configs: AdapterConfig[]): StripCell {
    const newest = configs
        .filter((config) => config.overview?.lastBackup)
        .sort((a, b) => Date.parse(b.overview!.lastBackup!.at) - Date.parse(a.overview!.lastBackup!.at))[0];
    return {
        label: "Last backup",
        icon: Archive,
        value: newest ? <RelativeTime date={newest.overview!.lastBackup!.at} /> : "-",
        extra: newest ? `of ${newest.name}` : "no backup yet",
    };
}

function storedCell(configs: AdapterConfig[]): StripCell {
    const stored = configs.filter((config) => config.overview?.stored);
    const size = stored.reduce((sum, config) => sum + (config.overview?.stored?.size ?? 0), 0);
    const backups = stored.reduce((sum, config) => sum + (config.overview?.stored?.count ?? 0), 0);
    const [value, unit] = formatBytes(size, 1).split(" ");
    return {
        label: "Stored",
        icon: Layers,
        value: stored.length > 0 ? value : "-",
        unit: stored.length > 0 ? unit : undefined,
        extra: stored.length > 0 ? `${backups.toLocaleString()} backups at the last scan` : "not scanned yet",
    };
}

/** Channels have no health check, so their numbers say where they are used and how the last message went. */
function channelCells(configs: AdapterConfig[]): StripCell[] {
    const used = configs.filter((config) => (config.overview?.usedBy.jobs ?? 0) + (config.overview?.usedBy.templates ?? 0) > 0);
    const jobs = configs.reduce((sum, config) => sum + (config.overview?.usedBy.jobs ?? 0), 0);
    const templates = configs.reduce((sum, config) => sum + (config.overview?.usedBy.templates ?? 0), 0);
    const newest = configs
        .filter((config) => config.overview?.lastSent)
        .sort((a, b) => Date.parse(b.overview!.lastSent!.at) - Date.parse(a.overview!.lastSent!.at))[0];
    const failing = configs.filter((config) => config.overview?.lastSent?.status === "Failed").map((config) => config.name);
    return [
        {
            label: "In use",
            icon: CalendarClock,
            value: used.length.toLocaleString(),
            unit: `of ${configs.length.toLocaleString()}`,
            extra: `by ${jobs.toLocaleString()} ${jobs === 1 ? "job" : "jobs"} and ${templates.toLocaleString()} ${templates === 1 ? "template" : "templates"}`,
        },
        {
            label: "Last sent",
            icon: Send,
            value: newest ? <RelativeTime date={newest.overview!.lastSent!.at} /> : "-",
            extra: newest ? `through ${newest.name}` : "nothing sent yet",
        },
        {
            label: "Failed",
            icon: CircleX,
            value: failing.length.toLocaleString(),
            tone: failing.length > 0 ? "destructive" : undefined,
            extra: failing.length > 0 ? `the last message of ${namesFor(failing)} failed` : "every last message went out",
        },
    ];
}

/** The numbers above a list of connections, worked out from the list itself, for each kind its own. */
export function ConnectionStrip({ kind, configs }: { kind: ConnectionKind; configs: AdapterConfig[] }) {
    const count: StripCell = { label: KIND[kind].label, icon: KIND[kind].icon, value: configs.length.toLocaleString(), extra: configs.length > 0 ? typesOf(configs) : "none yet" };
    const cells: StripCell[] = kind === "notification"
        ? [count, ...channelCells(configs)]
        : kind === "destination"
            ? [count, answeringCell(configs), responseCell(configs), storedCell(configs), inJobCell(configs)]
            : [count, answeringCell(configs), responseCell(configs), inJobCell(configs), lastBackupCell(configs)];
    return <ExplorerStrip joined cells={cells} />;
}
