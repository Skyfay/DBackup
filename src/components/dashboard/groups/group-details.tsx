"use client";

import { ArrowRight, Copy, Pencil, Plus, UserPlus, type LucideIcon } from "lucide-react";
import { Section } from "@/components/adapter/connection-details-sections";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { UserAvatar, YouTag } from "@/components/dashboard/users/user-cells";
import { LinesSkeleton } from "@/components/dashboard/users/user-details-sections";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePageModel } from "@/hooks/use-page-model";
import { accessSentences, summarizeAccess } from "@/lib/auth/access-summary";
import { LEVEL_LABELS, levelOf, rankOf, SUMMARY_AREAS } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import type { GroupDetails as GroupDetailsModel, GroupHistoryEntry, GroupMember, GroupRow } from "@/services/user/groups-types";
import { countWord, GroupTile, LevelDots, permissionCount, TOTAL_PERMISSIONS } from "./group-cells";
import { MadeText } from "./group-columns";

interface GroupDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    group: GroupRow | null;
    onClose: () => void;
    onEdit?: (group: GroupRow) => void;
    onDuplicate?: (group: GroupRow) => void;
    /** Moves one member to another group. Absent without the right to change users. */
    onMove?: (group: GroupRow, member: GroupMember) => void;
    /** Moves people into the group. Absent without the right to change users. */
    onAddPeople?: (group: GroupRow) => void;
    /** The rest of what the group can do, as the menu of its row shows it. */
    groupsMenu: BackupActionGroup[];
    /** Bumped after a change, so the history loads again. */
    version: number;
}

/** Everything about one group in a panel from the right: what it lets its members do, by area, who they are and how it changed. */
export function GroupDetails(props: GroupDetailsProps) {
    const { open, group, onClose } = props;
    return (
        <Sheet open={open && group !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {group && <Content {...props} group={group} />}
            </SheetContent>
        </Sheet>
    );
}

function Content({ group, onEdit, onDuplicate, onMove, onAddPeople, groupsMenu, version }: GroupDetailsProps & { group: GroupRow }) {
    const { model: details } = usePageModel<GroupDetailsModel>(`/api/groups/${encodeURIComponent(group.id)}?v=${version}`, "The group could not be loaded.");
    const shown = details?.id === group.id ? details : null;
    const held = new Set(group.permissions);
    const summary = summarizeAccess(group.permissions, group.superAdmin);

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <GroupTile group={group} size="lg" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <SheetTitle className="truncate text-lg font-semibold">{group.name}</SheetTitle>
                            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {countWord(group.members.length, "member", "members")}
                            </span>
                        </div>
                        <SheetDescription className="truncate text-sm text-muted-foreground">
                            <MadeText group={group} />
                            {group.changed && (
                                <>
                                    {" · changed "}
                                    <RelativeTime date={group.changed.at} />
                                </>
                            )}
                        </SheetDescription>
                    </div>
                </div>
                {(onEdit || onDuplicate || groupsMenu.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {onEdit && !group.superAdmin && (
                            <Button variant="outline" size="sm" onClick={() => onEdit(group)}>
                                <Pencil />
                                Edit
                            </Button>
                        )}
                        {onDuplicate && (
                            <Button variant="outline" size="sm" onClick={() => onDuplicate(group)}>
                                <Copy />
                                Duplicate
                            </Button>
                        )}
                        {groupsMenu.length > 0 && <BackupRowMenu name={group.name} groups={groupsMenu} variant="outline" align="start" />}
                    </div>
                )}
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    <Section title="Access">
                        <p className="text-sm leading-relaxed">{accessSentences(summary).join(" ")}</p>
                        <p className="text-xs text-muted-foreground">
                            {permissionCount(group)} of {TOTAL_PERMISSIONS} permissions
                        </p>
                    </Section>

                    <Section title="By area" aside={onEdit && !group.superAdmin ? "Edit to change" : undefined}>
                        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                            {SUMMARY_AREAS.map((area) => {
                                const level = group.superAdmin ? "full" : levelOf(area, held);
                                return (
                                    <div key={area.id} className="flex min-w-0 items-center gap-3 border-b py-2 text-sm">
                                        <dt className="min-w-0 flex-1 truncate">{area.label}</dt>
                                        <dd className="flex shrink-0 items-center gap-3">
                                            <LevelDots rank={group.superAdmin ? 4 : rankOf(area, held)} />
                                            <span className={cn("w-14 text-xs", level === "none" || level === "custom" ? "text-muted-foreground" : "text-foreground")}>
                                                {LEVEL_LABELS[level]}
                                            </span>
                                        </dd>
                                    </div>
                                );
                            })}
                        </dl>
                    </Section>

                    <Section
                        title="Members"
                        aside={onAddPeople ? (
                            <button type="button" onClick={() => onAddPeople(group)} className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
                                <UserPlus className="size-3.5" aria-hidden="true" />
                                Add people
                            </button>
                        ) : undefined}
                    >
                        {group.members.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nobody is in it yet.</p>
                        ) : (
                            <ul className="divide-y border-y">
                                {group.members.map((member) => (
                                    <li key={member.id} className="flex min-w-0 items-center gap-3 py-2.5">
                                        <UserAvatar user={member} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                                                <span className="truncate">{member.name}</span>
                                                {member.isYou && <YouTag />}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                                        </div>
                                        {onMove && !member.isYou && (
                                            <Button variant="ghost" size="sm" onClick={() => onMove(group, member)}>
                                                <ArrowRight />
                                                Move
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Section>

                    <Section title="Changes" aside={shown ? `the audit log keeps ${shown.auditDays} days` : undefined}>
                        {!shown ? (
                            <LinesSkeleton rows={2} />
                        ) : shown.history.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{group.superAdmin ? "Built in, it never changes." : "Nothing in the audit log."}</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {shown.history.map((entry) => <HistoryLine key={entry.id} entry={entry} />)}
                            </ul>
                        )}
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}

const HISTORY_ICONS: Record<GroupHistoryEntry["kind"], LucideIcon> = { create: Plus, update: Pencil, member: UserPlus };

/** "Manu changed Backups See to Use", with when. */
function HistoryLine({ entry }: { entry: GroupHistoryEntry }) {
    const Icon = HISTORY_ICONS[entry.kind];
    const text = entry.by ? `${entry.by} ${entry.text}` : entry.text.charAt(0).toUpperCase() + entry.text.slice(1);
    return (
        <li className="flex min-w-0 items-center gap-2.5 py-1.5 text-sm">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate" title={text}>{text}</span>
            <RelativeTime date={entry.at} className="shrink-0 text-xs text-muted-foreground" />
        </li>
    );
}
