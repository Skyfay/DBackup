"use client";

import { useState } from "react";
import { Globe, Lock, Minus } from "lucide-react";
import { toast } from "sonner";
import { setUserPlatformGroup, type PlatformGroupChoiceInput } from "@/app/actions/auth/platform-group";
import { Section } from "@/components/adapter/connection-details-sections";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageModel } from "@/hooks/use-page-model";
import { pickerLine, scopeText } from "@/lib/auth/platform-group-summary";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { UserRow } from "@/services/user/users-types";
import { PLATFORM_ADMIN_GROUP_ID, type PlatformGroupRow, type PlatformGroupsModel } from "@/services/user/platform-groups-types";
import { PlatformAdminConfirmDialog } from "./platform-admin-role";
import { givableBy } from "./platform-group-form";

const log = logger.child({ component: "user-platform-group" });

/** The pick of no platform group. */
export const NO_PLATFORM_GROUP = "none";

const NONE_ENTRY: PickEntry = { id: NO_PLATFORM_GROUP, name: "No platform group", meta: "Only their groups in the tenants count", glyph: Minus };

function entryOf(group: PlatformGroupRow): PickEntry {
    const meta = group.builtIn ? `Everything, every tenant · ${group.members.length} ${group.members.length === 1 ? "member" : "members"}` : pickerLine(group);
    return { id: group.id, name: group.name, meta, keywords: [meta], glyph: group.builtIn ? Lock : Globe };
}

/** The platform group an account holds now, as the id of its pick. */
export const platformGroupOf = (user: Pick<UserRow, "superAdmin" | "platformGroup">) => (user.superAdmin ? PLATFORM_ADMIN_GROUP_ID : user.platformGroup?.id ?? NO_PLATFORM_GROUP);

/** The choice the action takes for an entry of the list. */
export const platformChoiceOf = (id: string): PlatformGroupChoiceInput => (id === NO_PLATFORM_GROUP ? { kind: "none" } : id === PLATFORM_ADMIN_GROUP_ID ? { kind: "admin" } : { kind: "group", id });

/** Whether a pick makes someone a platform admin or ends it, which asks first. */
export const asksFirst = (user: Pick<UserRow, "superAdmin">, id: string) => id === PLATFORM_ADMIN_GROUP_ID || user.superAdmin;

/**
 * Why the viewer may not change the platform group of an account, null when they may: never the
 * own account, a platform admin's only a platform admin, and a group beyond the viewer stays.
 */
export function platformGroupLock(user: Pick<UserRow, "isYou" | "superAdmin" | "platformGroup">, model: PlatformGroupsModel | null): string | null {
    const viewer = model?.viewer;
    const current = model?.groups.find((group) => group.id === platformGroupOf(user));
    if (user.isYou) return "Another admin changes your own platform group.";
    if (user.superAdmin && viewer && !viewer.platformAdmin) return "Only a platform admin takes the platform admin role.";
    if (current && viewer && !givableBy(current, viewer)) return "Their platform group may do more than you may.";
    return null;
}

interface PlatformGroupPickProps extends Omit<React.ComponentProps<typeof PickTrigger>, "icon" | "children" | "value" | "loading"> {
    user: Pick<UserRow, "platformGroup">;
    model: PlatformGroupsModel | null;
    /** The id of the picked platform group, NO_PLATFORM_GROUP or PLATFORM_ADMIN_GROUP_ID, an empty string while nothing is picked. */
    value: string;
    onPick: (id: string) => void;
    /** Offers No platform group on top, which a new account of the platform has no use for. */
    withNone?: boolean;
    loading?: boolean;
}

/**
 * Picks the platform group of an account, in the turquoise of picking with No platform group
 * first, Platform admin and the other platform groups, each with what it gives and where. A group
 * that may do more than the viewer is left out, and the foot says so. The props of a form field
 * land on the button, so its label names it.
 */
export function PlatformGroupPick({ user, model, value, onPick, withNone = true, disabled = false, loading = false, ...props }: PlatformGroupPickProps) {
    const [open, setOpen] = useState(false);
    if (!model) return <Skeleton className="h-9 w-full" />;
    const groups = model.groups;
    const current: PickEntry | null = value === NO_PLATFORM_GROUP
        ? NONE_ENTRY
        : groups.map(entryOf).find((entry) => entry.id === value) ?? (value ? { id: value, name: user.platformGroup?.name ?? "Platform admin", meta: "" } : null);
    const givable = groups.filter((group) => givableBy(group, model.viewer));
    const leftOut = groups.length - givable.length;

    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger icon={current?.glyph ?? Globe} aria-expanded={open} aria-label="Platform group" {...props} disabled={disabled || loading} loading={loading} className="w-full">
                    {current ? (
                        <>
                            <span className="max-w-full flex-none truncate font-medium">{current.name}</span>
                            {current.meta && <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:inline">{current.meta}</span>}
                        </>
                    ) : (
                        <span className="truncate text-muted-foreground">Pick a platform group</span>
                    )}
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Globe}
                    title="Pick a platform group"
                    note="What it gives on the platform and where"
                    searchPlaceholder="Find a platform group"
                    groups={[...(withNone ? [{ entries: [NONE_ENTRY] }] : []), { heading: withNone ? "Platform groups" : undefined, entries: givable.map(entryOf) }]}
                    value={value}
                    emptyText="Nothing matches."
                    aside={leftOut > 0 ? <p className="text-xs text-muted-foreground">{leftOut === 1 ? "1 group may do more than you may, so it is not listed" : `${leftOut} groups may do more than you may, so they are not listed`}</p> : undefined}
                    onPick={(id) => {
                        setOpen(false);
                        onPick(id);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}

/** What the line under the pick says about the platform group of an account. */
export function platformGroupNote(user: Pick<UserRow, "superAdmin">, group: PlatformGroupRow | undefined): string {
    if (user.superAdmin) return "One per account. A platform admin holds every right in every tenant.";
    if (!group) return "One per account. Only their groups in the tenants count.";
    const scope = !group.builtIn && group.tenantPermissions.length > 0 ? scopeText(group).toLowerCase() : null;
    return `One per account. It counts on top of their group in each tenant${scope ? `, here in ${scope}` : ""}.`;
}

interface UserPlatformGroupSectionProps {
    /** A row of the list of every account, which names its platform group. */
    user: UserRow;
    /** May give platform groups, the right to manage the accounts of the platform. */
    canManage: boolean;
    onChanged: () => void;
}

/**
 * The platform group of an account in its panel under Platform, changed at once. One per account.
 * Platform admin, and taking it, ask first and are a platform admin's to give.
 */
export function UserPlatformGroupSection({ user, canManage, onChanged }: UserPlatformGroupSectionProps) {
    const { model } = usePageModel<PlatformGroupsModel>("/api/platform/platform-groups", "The platform groups could not be loaded.");
    const [pending, setPending] = useState(false);
    const [asked, setAsked] = useState<string | null>(null);
    const value = platformGroupOf(user);
    const lock = canManage ? platformGroupLock(user, model) : null;

    const apply = async (id: string) => {
        setPending(true);
        try {
            const result = await setUserPlatformGroup(user.id, platformChoiceOf(id));
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`${user.name} holds ${result.data.to === "No platform group" ? "no platform group" : result.data.to} now`);
            setAsked(null);
            onChanged();
        } catch (error: unknown) {
            log.warn("Giving a platform group failed", { userId: user.id }, wrapError(error));
            toast.error("The platform group could not be changed.");
        } finally {
            setPending(false);
        }
    };

    const pick = (id: string) => {
        if (id === value) return;
        // Becoming a platform admin, or stopping to be one, asks first.
        if (asksFirst(user, id)) setAsked(id);
        else void apply(id);
    };

    return (
        <Section title="Platform group" aside="from Platform, Users & Groups, Platform groups">
            <PlatformGroupPick user={user} model={model} value={value} onPick={pick} disabled={!canManage || lock !== null} loading={pending} />
            <p className="text-xs text-muted-foreground">{lock ?? platformGroupNote(user, model?.groups.find((group) => group.id === value))}</p>

            {asked && (
                <PlatformAdminConfirmDialog
                    name={user.name || user.email}
                    on={asked === PLATFORM_ADMIN_GROUP_ID}
                    pending={pending}
                    onClose={() => !pending && setAsked(null)}
                    onConfirm={() => void apply(asked)}
                />
            )}
        </Section>
    );
}
