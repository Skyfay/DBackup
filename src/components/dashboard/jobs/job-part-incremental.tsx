"use client";

import { useDeferredValue, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Database, FolderOpen, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { ChoiceCards, type ModeOption } from "@/components/adapter/connection-mode-choice";
import { SwitchList } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Switch } from "@/components/ui/switch";
import { getAdapterDefinition } from "@/lib/adapters/definitions";
import { cn } from "@/lib/utils";
import { chainSize, isLongChain, shorterChains, upcomingRuns, type ChainSize } from "./incremental-chain";
import type { AdapterOption, JobFormValues } from "./job-form-schema";
import { PartSection } from "./job-part-section";
import { describeSchedule } from "./job-schedule";
import { useSchedulerTimezone } from "./use-scheduler-timezone";

const MODES: ModeOption[] = [
    { value: "FULL", title: "Every backup in full", description: "Each one stands on its own" },
    { value: "INCREMENTAL", title: "Only what changed", description: "Folders store changed files, chained to a full" },
];

/** How many runs of a chain the strip draws before it only counts the rest. */
const STRIP_RUNS = 12;

const TILE = "flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground";

const daysText = (days: number) => (days === 1 ? "day" : `${days} days`);

/** "7", "up to 45" or "at least 1,000", the backups of the longest of the chains. */
function countOf(size: ChainSize): string {
    if (size.open) return `at least ${size.first.toLocaleString()}`;
    return `${size.fewest === size.most ? "" : "up to "}${size.most.toLocaleString()}`;
}

/** What a chain holds, in a sentence under the strip. */
function captionOf(size: ChainSize, days: number): string {
    if (size.most === 1) return `Every backup is a full one, since the runs are at least ${days === 1 ? "a day" : `${days} days`} apart.`;
    const after = (count: number) => (count - 1).toLocaleString();
    const count = size.open
        ? `at least ${after(size.first)}`
        : size.fewest === size.most
            ? after(size.most)
            : size.fewest === 1
                ? `up to ${after(size.most)}`
                : `${after(size.fewest)} to ${after(size.most)}`;
    return `Each chain is a full backup, then ${count} incremental ${count === "1" ? "one" : "ones"}.`;
}

/** The first chain as boxes, F for its full and i for each incremental, and the full of the next one. */
function ChainStrip({ size }: { size: ChainSize }) {
    const drawn = Math.min(size.first, STRIP_RUNS);
    const box = "flex size-6.5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold";
    const full = cn(box, "bg-tone text-tone-foreground");
    return (
        <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: drawn }, (_, index) => (
                <span key={index} className={index === 0 ? full : cn(box, "border border-tone/55 bg-tone/12 text-tone")}>
                    {index === 0 ? "F" : "i"}
                </span>
            ))}
            {size.first > STRIP_RUNS ? (
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">{size.open ? "…" : `+${(size.first - STRIP_RUNS).toLocaleString()}`}</span>
            ) : (
                <span className={cn(full, "ml-2 opacity-60")}>F</span>
            )}
        </div>
    );
}

/** How often a new chain starts, what one holds on the job's schedule, and a warning when that is long. */
function ChainSection() {
    const form = useFormContext<JobFormValues>();
    const timezone = useSchedulerTimezone();
    const [schedule, days] = form.watch(["schedule", "fullEveryDays"]);
    // Working out the runs waits for typing to settle, so the stepper stays quick.
    const deferredSchedule = useDeferredValue(schedule);
    const deferredDays = useDeferredValue(days);
    const runs = useMemo(() => (timezone ? upcomingRuns(deferredSchedule, timezone) : []), [deferredSchedule, timezone]);
    const size = useMemo(() => chainSize(runs, deferredDays), [runs, deferredDays]);
    const shorter = useMemo(() => shorterChains(runs, deferredDays), [runs, deferredDays]);
    // A full every day is the shortest there is, so a job that runs that often is not warned about it.
    const long = size && deferredDays > 1 && isLongChain(size) ? size : null;

    return (
        <PartSection title="The chain" hint={describeSchedule(schedule).text}>
            <FormField
                control={form.control}
                name="fullEveryDays"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Full backup every</FormLabel>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                            <FormControl>
                                <NumberStepper
                                    value={field.value}
                                    onValueChange={field.onChange}
                                    onBlur={field.onBlur}
                                    min={1}
                                    max={365}
                                    decrementLabel="Fewer days"
                                    incrementLabel="More days"
                                />
                            </FormControl>
                            <span className="text-sm text-muted-foreground">{field.value === 1 ? "day" : "days"}, each one starts a new chain</span>
                        </div>
                        <FormMessage />
                    </FormItem>
                )}
            />

            {size && (
                <div className="space-y-2 pt-1">
                    <ChainStrip size={size} />
                    <p className="text-xs text-muted-foreground">{captionOf(size, deferredDays)}</p>
                </div>
            )}

            {long && (
                <div role="status" className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                        A chain of {countOf(long)} backups: a damaged one takes every backup built on it.
                        {shorter && ` A new full every ${daysText(shorter.days)} keeps a chain at ${countOf(shorter.size)}.`}
                    </span>
                    {shorter && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 border-warning/50 bg-card text-xs hover:bg-warning/15 dark:border-warning/50 dark:bg-card dark:hover:bg-warning/20"
                            onClick={() => form.setValue("fullEveryDays", shorter.days, { shouldDirty: true, shouldValidate: true })}
                        >
                            Every {daysText(shorter.days)}
                        </Button>
                    )}
                </div>
            )}
        </PartSection>
    );
}

interface Participant {
    key: string;
    icon: LucideIcon;
    name: string;
    meta: string;
    /** Whether it stores only what changed, or goes into every backup in full. */
    changes: boolean;
}

const typeOf = (option: AdapterOption) => getAdapterDefinition(option.adapterId)?.name ?? option.adapterId;

/** The sources of the Source part, and whether each one stores only its changes. */
function TakesPart({ sources, folderOptions }: IncrementalPartProps) {
    const form = useFormContext<JobFormValues>();
    const [mode, sourceId, folders] = form.watch(["sourceMode", "sourceId", "directorySources"]);
    const database = mode !== "dirs" ? sources.find((option) => option.id === sourceId) : undefined;
    const rows: Participant[] = [
        ...(database ? [{ key: database.id, icon: Database, name: database.name, meta: `${typeOf(database)} · a dump is always whole`, changes: false }] : []),
        ...folders.flatMap((folder, index) => {
            const connection = folderOptions.find((option) => option.id === folder.configId);
            if (!connection) return [];
            return [{ key: `${index}-${folder.path}`, icon: FolderOpen, name: folder.path ? `${connection.name} · ${folder.path}` : connection.name, meta: typeOf(connection), changes: true }];
        }),
    ];

    return (
        <PartSection title="What takes part" hint="from the Source part">
            {rows.length > 0 ? (
                <ul className="divide-y rounded-lg border">
                    {rows.map((row) => (
                        <li key={row.key} className="flex items-center gap-3 px-3 py-2.5">
                            <span className={TILE} aria-hidden="true">
                                <row.icon className="size-4" />
                            </span>
                            <span className="grid min-w-0 flex-1 gap-0.5">
                                <span className="truncate text-sm font-medium">{row.name}</span>
                                <span className="truncate text-xs text-muted-foreground">{row.meta}</span>
                            </span>
                            <span
                                className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                                    row.changes ? "bg-success/12 text-success" : "border text-muted-foreground",
                                )}
                            >
                                {row.changes ? "Only changes" : "In full every run"}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground">No folders yet. Add them in the Source part.</p>
            )}
        </PartSection>
    );
}

interface IncrementalPartProps {
    sources: AdapterOption[];
    folderOptions: AdapterOption[];
}

/**
 * Whether the backups store everything or only what changed. The job decides how its chains are
 * built, and the source says what can take part: folders store only their changes, a database is
 * dumped whole until its adapter can do more. The chain is worked out on the job's schedule, the
 * way the chain planner builds it, and a long one gets a shorter setting to use.
 */
export function IncrementalPart({ sources, folderOptions }: IncrementalPartProps) {
    const form = useFormContext<JobFormValues>();
    const [mode, backupMode] = form.watch(["sourceMode", "backupMode"]);
    const withFolders = mode !== "db";
    const incremental = withFolders && backupMode === "INCREMENTAL";

    return (
        <>
            <FormField
                control={form.control}
                name="backupMode"
                render={({ field }) => (
                    <FormItem>
                        <FormControl>
                            <ChoiceCards
                                // A job of only a database is saved as full, whatever an earlier setting left.
                                value={withFolders ? field.value : "FULL"}
                                onValueChange={field.onChange}
                                options={withFolders ? MODES : MODES.map((option) => ({ ...option, disabled: true }))}
                                aria-label="What a backup stores"
                            />
                        </FormControl>
                        {!withFolders && (
                            <p className="flex gap-2.5 text-sm text-muted-foreground">
                                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                                So far only folders can be stored in part. This job backs up only a database, so every backup is full. A database joins in once its adapter
                                can do it.
                            </p>
                        )}
                        {withFolders && !incremental && <p className="text-xs text-muted-foreground">Every backup is complete on its own. Losing one costs only that one.</p>}
                    </FormItem>
                )}
            />

            {incremental && (
                <>
                    <ChainSection />
                    <SwitchList>
                        <FormField
                            control={form.control}
                            name="verifyByHash"
                            render={({ field }) => (
                                <FormItem className="flex items-center gap-4 px-4 py-3">
                                    <div className="grid min-w-0 flex-1 gap-0.5">
                                        <FormLabel>Detect changes by content</FormLabel>
                                        <p className="text-xs text-muted-foreground">
                                            Reads every file instead of trusting its size and time. Only needed where those can stay the same after a change.
                                        </p>
                                    </div>
                                    <FormControl>
                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </SwitchList>
                    <TakesPart sources={sources} folderOptions={folderOptions} />
                </>
            )}
        </>
    );
}
