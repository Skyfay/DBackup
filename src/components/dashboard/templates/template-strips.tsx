"use client";

import { useMemo } from "react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { readCron } from "@/lib/core/cron";
import { resolveExcludePatterns } from "@/lib/exclude-groups";
import type { TemplatesModel } from "@/services/templates/templates-types";
import { clashingJobs } from "./template-attention";
import { count, listed } from "./template-format";

type Model = TemplatesModel | null;

function unusedCell<T extends { name: string }>(rows: T[] | undefined, inUse: (row: T) => boolean, noun: string) {
    const unused = rows?.filter((row) => !inUse(row)) ?? [];
    return {
        label: "Unused",
        value: rows ? unused.length.toLocaleString() : "-",
        extra: unused.length > 0 ? listed(unused.map((row) => row.name)) : `every ${noun} is in use`,
    };
}

/** The numbers above the retention policies. */
export function RetentionStrip({ model }: { model: Model }) {
    const rows = model?.retention;
    const totals = model?.retentionTotals;
    const fallback = rows?.find((row) => row.isDefault);
    const builtIn = rows?.filter((row) => row.isSystem).length ?? 0;
    const keepAll = (rows ?? []).filter((row) => row.config.mode === "NONE").reduce((sum, row) => sum + row.uses.length, 0) + (!fallback && totals ? totals.followDefault : 0);
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Policies", value: rows ? rows.length.toLocaleString() : "-", extra: rows ? `${builtIn} built in, ${rows.length - builtIn} of yours` : " " },
                {
                    label: "Default",
                    value: rows ? (fallback?.name ?? "None") : "-",
                    tone: rows && !fallback && (totals?.followDefault ?? 0) > 0 ? "warning" : undefined,
                    extra: !totals ? " " : fallback ? `${count(totals.followDefault, "destination")} ${totals.followDefault === 1 ? "follows" : "follow"} it` : "destinations without a policy keep every backup",
                },
                {
                    label: "Destinations",
                    value: totals ? totals.destinations.toLocaleString() : "-",
                    extra: totals ? [`${totals.picked} picked a policy`, `${totals.followDefault} follow the default`, ...(totals.own > 0 ? [`${totals.own} their own`] : [])].join(", ") : " ",
                },
                { label: "Keep everything", value: rows ? keepAll.toLocaleString() : "-", extra: keepAll > 0 ? "destinations never remove a backup" : "every destination removes old backups" },
                unusedCell(rows, (row) => row.uses.length + row.prefills.length > 0, "policy"),
            ]}
        />
    );
}

/** The numbers above the file names. */
export function NamingStrip({ model }: { model: Model }) {
    const rows = model?.naming;
    const totals = model?.namingTotals;
    const fallback = rows?.find((row) => row.isDefault);
    const clashing = useMemo(() => (model ? clashingJobs(model) : []), [model]);
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Templates", value: rows ? rows.length.toLocaleString() : "-", extra: rows ? `${rows.filter((row) => row.isSystem).length} built in` : " " },
                {
                    label: "Default",
                    value: rows ? (fallback?.name ?? "None") : "-",
                    extra: totals ? `${count(totals.followDefault, "job")} without ${totals.followDefault === 1 ? "its" : "their"} own ${totals.followDefault === 1 ? "follows" : "follow"} it` : " ",
                },
                { label: "Jobs", value: totals ? totals.jobs.toLocaleString() : "-", extra: totals ? `${totals.picked} picked a template, ${totals.followDefault} follow the default` : " " },
                {
                    label: "Names repeat",
                    value: model ? clashing.length.toLocaleString() : "-",
                    tone: clashing.length > 0 ? "warning" : undefined,
                    extra: clashing.length > 0 ? `${listed(clashing.map((job) => job.name))}, runs replace each other` : "every run gets a name of its own",
                },
                unusedCell(rows, (row) => row.uses.length > 0, "template"),
            ]}
        />
    );
}

/** The numbers above the schedule presets. */
export function ScheduleStrip({ model }: { model: Model }) {
    const rows = model?.schedules;
    const following = rows?.reduce((sum, row) => sum + row.jobIds.length, 0) ?? 0;
    const jobs = model?.jobs.length ?? 0;
    const next = useMemo(() => {
        if (!model) return null;
        const now = new Date();
        return model.schedules
            .filter((row) => row.jobIds.length > 0)
            .map((row) => ({ row, at: readCron(row.schedule, model.timezone)?.nextRun(now) ?? null }))
            .filter((entry): entry is { row: (typeof model.schedules)[number]; at: Date } => entry.at !== null)
            .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
    }, [model]);
    const busiest = [...(rows ?? [])].sort((a, b) => b.jobIds.length - a.jobIds.length)[0];
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Presets", value: rows ? rows.length.toLocaleString() : "-", extra: "schedules jobs can follow" },
                { label: "Jobs", value: model ? `${following} of ${jobs}` : "-", extra: model ? `follow a preset, ${jobs - following} their own schedule` : " " },
                { label: "Next start", value: next ? <RelativeTime date={next.at} /> : "-", extra: next ? next.row.name : "no job follows a preset" },
                {
                    label: "Most jobs",
                    value: busiest && busiest.jobIds.length > 0 ? busiest.jobIds.length.toLocaleString() : "-",
                    extra: busiest && busiest.jobIds.length > 0 ? `start with ${busiest.name}` : "no job follows a preset",
                },
                unusedCell(rows, (row) => row.jobIds.length > 0, "preset"),
            ]}
        />
    );
}

/** The numbers above the notification templates. */
export function NotificationStrip({ model }: { model: Model }) {
    const rows = model?.notifications;
    const fallback = rows?.find((row) => row.isDefault);
    const channels = new Map((rows ?? []).flatMap((row) => row.channels.map((channel) => [channel.configId, channel.config.name] as const)));
    const hearing = new Set((rows ?? []).flatMap((row) => row.jobIds)).size;
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Templates", value: rows ? rows.length.toLocaleString() : "-", extra: rows ? `over ${count(channels.size, "channel")}` : " " },
                { label: "Default", value: rows ? (fallback?.name ?? "None") : "-", extra: fallback ? "new jobs start with it" : "new jobs start without one" },
                { label: "Jobs", value: model ? `${hearing} of ${model.jobs.length}` : "-", extra: "hear about their runs through one" },
                { label: "Channels", value: rows ? channels.size.toLocaleString() : "-", extra: channels.size > 0 ? listed([...channels.values()]) : "no template sends yet" },
                unusedCell(rows, (row) => row.jobIds.length > 0, "template"),
            ]}
        />
    );
}

/** The numbers above the exclude presets. */
export function ExcludeStrip({ model }: { model: Model }) {
    const rows = model?.excludes;
    const defaults = rows?.filter((row) => row.isDefault) ?? [];
    const patterns = new Set((rows ?? []).flatMap((row) => resolveExcludePatterns(row)));
    const groups = new Set((rows ?? []).flatMap((row) => row.groups));
    return (
        <ExplorerStrip joined
            cells={[
                { label: "Presets", value: rows ? rows.length.toLocaleString() : "-", extra: rows ? `${rows.filter((row) => row.isSystem).length} built in` : " " },
                {
                    label: "Default",
                    value: rows ? (defaults.length === 1 ? defaults[0].name : defaults.length.toLocaleString()) : "-",
                    extra: defaults.length === 0 ? "new folders start without one" : defaults.length === 1 ? "new folders start with it" : `new folders start with ${listed(defaults.map((row) => row.name))}`,
                },
                { label: "Folders", value: model ? `${model.folders.withPreset} of ${model.folders.total}` : "-", extra: "skip what a preset names" },
                { label: "Patterns", value: rows ? patterns.size.toLocaleString() : "-", extra: `from ${count(groups.size, "group")} of DBackup and their own` },
                unusedCell(rows, (row) => row.folders.length > 0, "preset"),
            ]}
        />
    );
}
