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

const NONE = "none";

const NONE_ENTRY: PickEntry = { id: NONE, name: "No platform group", meta: "Only their groups in the tenants count", glyph: Minus };

function entryOf(group: PlatformGroupRow): PickEntry {
    const meta = group.builtIn ? `Everything, every tenant · ${group.members.length} ${group.members.length === 1 ? "member" : "members"}` : pickerLine(group);
    return { id: group.id, name: group.name, meta, keywords: [meta], glyph: group.builtIn ? Lock : Globe };
}

/** The choice the action takes for an entry of the list. */
const choiceOf = (id: string): PlatformGroupChoiceInput => (id === NONE ? { kind: "none" } : id === PLATFORM_ADMIN_GROUP_ID ? { kind: "admin" } : { kind: "group", id });

interface UserPlatformGroupSectionProps {
    /** A row of the list of every account, which names its platform group. */
    user: UserRow;
    /** May give platform groups, the right to manage the accounts of the platform. */
    canManage: boolean;
    onChanged: () => void;
}

/**
 * The platform group of an account in its panel under Platform: a pick in the turquoise of picking
 * with No platform group first, Platform admin and the other platform groups, each with what it
 * gives and where. One per account. Platform admin, and taking it, ask first and are a platform
 * admin's to give, and a group that may do more than the viewer is left out.
 */
export function UserPlatformGroupSection({ user, canManage, onChanged }: UserPlatformGroupSectionProps) {
    const { model } = usePageModel<PlatformGroupsModel>("/api/platform/platform-groups", "The platform groups could not be loaded.");
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [asked, setAsked] = useState<string | null>(null);
    const value = user.superAdmin ? PLATFORM_ADMIN_GROUP_ID : user.platformGroup?.id ?? NONE;
    const viewer = model?.viewer;
    const groups = model?.groups ?? [];
    const current = value === NONE ? NONE_ENTRY : groups.map(entryOf).find((entry) => entry.id === value) ?? { id: value, name: user.platformGroup?.name ?? "Platform admin", meta: "" };
    const currentGroup = groups.find((group) => group.id === value);

    // Who may change it at all: never the own account, a platform admin's only a platform admin, and a group beyond the viewer stays.
    const lock = !canManage
        ? null
        : user.isYou
          ? "Another admin changes your own platform group."
          : user.superAdmin && viewer && !viewer.platformAdmin
            ? "Only a platform admin takes the platform admin role."
            : currentGroup && viewer && !givableBy(currentGroup, viewer)
              ? "Their platform group may do more than you may."
              : null;
    const givable = viewer ? groups.filter((group) => givableBy(group, viewer)) : [];
    const leftOut = groups.length - givable.length;

    const apply = async (id: string) => {
        setPending(true);
        try {
            const result = await setUserPlatformGroup(user.id, choiceOf(id));
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
        setOpen(false);
        if (id === value) return;
        // Becoming a platform admin, or stopping to be one, asks first.
        if (id === PLATFORM_ADMIN_GROUP_ID || user.superAdmin) setAsked(id);
        else void apply(id);
    };

    const scope = currentGroup && !currentGroup.builtIn && currentGroup.tenantPermissions.length > 0 ? scopeText(currentGroup).toLowerCase() : null;
    const note = user.superAdmin
        ? "One per account. A platform admin holds every right in every tenant."
        : currentGroup
          ? `One per account. It counts on top of their group in each tenant${scope ? `, here in ${scope}` : ""}.`
          : "One per account. Only their groups in the tenants count.";

    return (
        <Section title="Platform group" aside="from Platform, Users & Groups, Groups">
            {!model ? (
                <Skeleton className="h-9 w-full" />
            ) : (
                <Popover open={open} onOpenChange={setOpen} modal>
                    <PopoverTrigger asChild>
                        <PickTrigger icon={current.glyph ?? Globe} aria-expanded={open} aria-label="Platform group" disabled={!canManage || lock !== null || pending} loading={pending} className="w-full">
                            <span className="truncate font-medium">{current.name}</span>
                            {current.meta && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{current.meta}</span>}
                        </PickTrigger>
                    </PopoverTrigger>
                    <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                        <PickList
                            icon={Globe}
                            title="Pick a platform group"
                            note="What it gives on the platform and where"
                            searchPlaceholder="Find a platform group"
                            groups={[{ entries: [NONE_ENTRY] }, { heading: "Platform groups", entries: givable.map(entryOf) }]}
                            value={value}
                            emptyText="Nothing matches."
                            aside={leftOut > 0 ? <p className="text-xs text-muted-foreground">{leftOut === 1 ? "1 group may do more than you may, so it is not listed" : `${leftOut} groups may do more than you may, so they are not listed`}</p> : undefined}
                            onPick={pick}
                        />
                    </PopoverContent>
                </Popover>
            )}
            <p className="text-xs text-muted-foreground">{lock ?? note}</p>

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
