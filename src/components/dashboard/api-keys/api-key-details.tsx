"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import { FactList, Section } from "@/components/adapter/connection-details-sections";
import { LevelStrip, TOTAL_PERMISSIONS } from "@/components/dashboard/groups/group-cells";
import { runHref } from "@/components/dashboard/history/run-links";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { LinesSkeleton } from "@/components/dashboard/users/user-details-sections";
import { getStatusStyle } from "@/components/dashboard/widgets/execution-status";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { DateDisplay } from "@/components/utils/date-display";
import { usePageModel } from "@/hooks/use-page-model";
import { accessSentences, listWords, summarizeAccess } from "@/lib/auth/access-summary";
import { exampleTaskFor, templateExample } from "@/lib/auth/api-key-templates";
import { permissionPhrase } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import type { ApiKeyDetails as ApiKeyDetailsModel, ApiKeyRow } from "@/services/auth/api-keys-types";
import { KeyTile, PrefixText, StateBadge } from "./api-key-cells";

interface ApiKeyDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    apiKey: ApiKeyRow | null;
    now: number;
    onClose: () => void;
    onEdit?: (key: ApiKeyRow) => void;
    onRotate?: (key: ApiKeyRow) => void;
    /** The rest of what the key can have done to it, as the menu of its row shows it. */
    keyMenu: BackupActionGroup[];
    /** May open the runs the key started. */
    canOpenRuns: boolean;
    /** Bumped after a change, so the runs and the audit load again. */
    version: number;
}

/** Everything about one key in a panel from the right: what it may do, how it is used, the runs it started and a first request. */
export function ApiKeyDetails(props: ApiKeyDetailsProps) {
    const { open, apiKey, onClose } = props;
    return (
        <Sheet open={open && apiKey !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {apiKey && <Content {...props} apiKey={apiKey} />}
            </SheetContent>
        </Sheet>
    );
}

function Content({ apiKey, now, onEdit, onRotate, keyMenu, canOpenRuns, version }: ApiKeyDetailsProps & { apiKey: ApiKeyRow }) {
    const { model: details } = usePageModel<ApiKeyDetailsModel>(`/api/api-keys/${encodeURIComponent(apiKey.id)}?v=${version}`, "The key could not be loaded.");
    const shown = details?.id === apiKey.id ? details : null;
    const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
    const example = templateExample(exampleTaskFor(apiKey.effective), origin, null);
    const owner = apiKey.isMine ? "you" : apiKey.owner.name;

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <KeyTile size="lg" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <SheetTitle className="truncate text-lg font-semibold">{apiKey.name}</SheetTitle>
                            <StateBadge apiKey={apiKey} now={now} />
                        </div>
                        <SheetDescription className="truncate text-sm text-muted-foreground">
                            <PrefixText prefix={apiKey.prefix} />
                            {" · made "}
                            <DateDisplay date={apiKey.createdAt} format="P" />
                            {shown?.made?.by && ` by ${shown.made.by}`}
                        </SheetDescription>
                    </div>
                </div>
                {(onEdit || onRotate || keyMenu.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {onEdit && (
                            <Button variant="outline" size="sm" onClick={() => onEdit(apiKey)}>
                                <Pencil />
                                Edit
                            </Button>
                        )}
                        {onRotate && (
                            <Button variant="outline" size="sm" onClick={() => onRotate(apiKey)}>
                                <RefreshCw />
                                Rotate
                            </Button>
                        )}
                        {keyMenu.length > 0 && <BackupRowMenu name={apiKey.name} groups={keyMenu} variant="outline" align="start" />}
                    </div>
                )}
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    <Section title="What it may do" aside={onEdit ? "Edit to change" : undefined}>
                        <p className="text-sm leading-relaxed">
                            {apiKey.effective.length === 0 ? "Nothing right now." : accessSentences(summarizeAccess(apiKey.effective)).join(" ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {apiKey.effective.length} of {TOTAL_PERMISSIONS} permissions, never more than {owner} may do
                        </p>
                        {apiKey.paused.length > 0 && (
                            <Notice tone="warning" title="Paused">
                                The group of {owner} no longer may {listWords(apiKey.paused.map(permissionPhrase))}, so the key may not either. It keeps {apiKey.paused.length === 1 ? "the permission" : "these permissions"} and may again once the group does.
                            </Notice>
                        )}
                        <LevelStrip permissions={apiKey.effective} />
                    </Section>

                    <Section title="Use">
                        <FactList
                            columns={1}
                            facts={[
                                { label: "Last used", value: apiKey.lastUsedAt ? <RelativeTime date={apiKey.lastUsedAt} /> : "never" },
                                {
                                    label: apiKey.state === "expired" ? "Ran out" : "Runs out",
                                    value: apiKey.expiresAt ? (
                                        <>
                                            <RelativeTime date={apiKey.expiresAt} />
                                            {", on "}
                                            <DateDisplay date={apiKey.expiresAt} format="P" />
                                        </>
                                    ) : (
                                        "never"
                                    ),
                                },
                                { label: "Acts as", value: apiKey.owner.groupName ? `${apiKey.owner.name}, group ${apiKey.owner.groupName}` : `${apiKey.owner.name}, no group` },
                                {
                                    label: "Rotated",
                                    value: !shown ? (
                                        <Skeleton className="ml-auto h-4 w-24" />
                                    ) : shown.rotated ? (
                                        <>
                                            <RelativeTime date={shown.rotated.at} />
                                            {shown.rotated.by && ` by ${shown.rotated.by}`}
                                        </>
                                    ) : (
                                        `not in the last ${shown.auditDays} days`
                                    ),
                                },
                            ]}
                        />
                    </Section>

                    <Section title="Runs it started" aside={shown && shown.runs.length > 0 ? "the newest first" : undefined}>
                        {!shown ? (
                            <LinesSkeleton rows={2} />
                        ) : shown.runs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">It has not started a run.</p>
                        ) : (
                            <ul className="divide-y border-y">
                                {shown.runs.map((run) => {
                                    const style = getStatusStyle(run.status);
                                    const job = run.job ?? "A deleted job";
                                    return (
                                        <li key={run.id} className="flex min-w-0 items-center gap-2.5 py-2 text-sm">
                                            <span className={cn("size-1.5 shrink-0 rounded-full", style.fill)} aria-hidden="true" />
                                            {canOpenRuns ? (
                                                <Link href={runHref(run.id, "apikeys")} className="min-w-0 flex-1 truncate rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
                                                    {job}
                                                </Link>
                                            ) : (
                                                <span className="min-w-0 flex-1 truncate">{job}</span>
                                            )}
                                            <span className={cn("shrink-0 text-xs", style.text)}>{style.label}</span>
                                            <RelativeTime date={run.at} className="w-28 shrink-0 text-right text-xs text-muted-foreground" />
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Section>

                    <Section title="How it is used" aside="the key itself shows only once">
                        <CodeBlock name={example.name} code={example.code} language="bash" />
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}
