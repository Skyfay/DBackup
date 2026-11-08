"use client";

import { useState } from "react";
import { User, Users } from "lucide-react";
import type { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useViewerPermissions } from "@/components/permissions/permissions-context";
import { accessLine, summarizeAccess } from "@/lib/auth/access-summary";
import type { UsersGroup } from "@/services/user/users-types";
import { groupBeyond } from "./user-access";
import { NO_GROUP } from "./user-columns";

const NONE: PickEntry = {
    id: NO_GROUP,
    name: "No group",
    meta: "Signs in, but sees and does nothing until someone picks a group",
    glyph: User,
};

function entryOf(group: Pick<UsersGroup, "id" | "name" | "permissions" | "superAdmin">): PickEntry {
    const access = accessLine(summarizeAccess(group.permissions, group.superAdmin));
    return { id: group.id, name: group.name, meta: access, keywords: [access] };
}

/** Why some groups are not in the list, for the foot of it. */
export function leftOutNote(names: string[]): string | null {
    if (names.length === 0) return null;
    return names.length === 1 ? `${names[0]} may do more than you may, so it is not listed` : `${names.length} groups may do more than you may, so they are not listed`;
}

interface GroupPickerProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    /** In the order they are listed, like the model of the page sorts them. */
    groups: Pick<UsersGroup, "id" | "name" | "permissions" | "superAdmin">[];
    /** A platform admin gives every group. Anyone else only finds the groups that may do no more than they may. */
    viewerPlatformAdmin: boolean;
    /** The id of the group, NO_GROUP, or an empty string while nothing is picked. */
    value: string;
    onChange: (id: string) => void;
    /** Offers No group on top, which an invitation has no use for. */
    allowNone?: boolean;
}

/**
 * Picks the group of a user, like the login field of a connection: No group and the groups in a
 * list with a search, where every row says what the group lets its members do. A group that may
 * do more than the viewer may is left out, and the foot says so. The list stays one field tall
 * however many groups there are. The props of a form field land on the button, so its label names it.
 */
export function GroupPicker({ groups, viewerPlatformAdmin, value, onChange, allowNone = true, ...props }: GroupPickerProps) {
    const [open, setOpen] = useState(false);
    const permissions = useViewerPermissions();
    const viewer = { platformAdmin: viewerPlatformAdmin, permissions };
    const current = value === NO_GROUP && allowNone ? NONE : groups.map(entryOf).find((entry) => entry.id === value);
    const pickable = groups.filter((group) => !groupBeyond(group, viewer));
    const note = leftOutNote(groups.filter((group) => groupBeyond(group, viewer)).map((group) => group.name));

    return (
        <div className="flex min-w-0 gap-2">
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger icon={current?.glyph ?? Users} aria-expanded={open} {...props}>
                        {current ? (
                            <>
                                {/* The name keeps its room, what the group does gets the rest. */}
                                <span className="max-w-full flex-none truncate">{current.name}</span>
                                <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:inline">{current.meta}</span>
                            </>
                        ) : (
                            <span className="truncate text-muted-foreground">Pick a group</span>
                        )}
                    </PickTrigger>
                </PopoverTrigger>
                {/* On the raised surface, so it stands out from the dialog it opens over. */}
                <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                    <PickList
                        icon={Users}
                        title="Pick a group"
                        note="What its members may do"
                        groups={[...(allowNone ? [{ entries: [NONE] }] : []), { heading: allowNone ? "Groups" : undefined, entries: pickable.map(entryOf) }]}
                        value={value}
                        emptyText={pickable.length === 0 && !allowNone ? "Every group may do more than you may." : "Nothing matches."}
                        aside={note ? <p className="text-xs text-muted-foreground">{note}</p> : undefined}
                        onPick={(id) => {
                            onChange(id);
                            setOpen(false);
                        }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
}
