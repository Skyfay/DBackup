"use client";

import { useState } from "react";
import { User, Users } from "lucide-react";
import type { Button } from "@/components/ui/button";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { accessLine, summarizeAccess } from "@/lib/auth/access-summary";
import type { UsersGroup } from "@/services/user/users-types";
import { NO_GROUP } from "./user-columns";

const NONE: PickEntry = {
    id: NO_GROUP,
    name: "No group",
    meta: "Signs in, but sees and does nothing until someone picks a group",
    glyph: User,
};

function entryOf(group: UsersGroup): PickEntry {
    const access = accessLine(summarizeAccess(group.permissions, group.superAdmin));
    return { id: group.id, name: group.name, meta: access, keywords: [access] };
}

interface GroupPickerProps extends Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> {
    /** In the order they are listed, like the model of the page sorts them. */
    groups: UsersGroup[];
    /** Only a SuperAdmin can give the SuperAdmin group, so nobody else finds it in the list. */
    viewerSuperAdmin: boolean;
    /** The id of the group, NO_GROUP, or an empty string while nothing is picked. */
    value: string;
    onChange: (id: string) => void;
}

/**
 * Picks the group of a user, like the login field of a connection: No group and the groups in a
 * list with a search, where every row says what the group lets its members do. The list stays one
 * field tall however many groups there are. The props of a form field land on the button, so its
 * label names it.
 */
export function GroupPicker({ groups, viewerSuperAdmin, value, onChange, ...props }: GroupPickerProps) {
    const [open, setOpen] = useState(false);
    const current = value === NO_GROUP ? NONE : groups.map(entryOf).find((entry) => entry.id === value);
    const pickable = groups.filter((group) => !group.superAdmin || viewerSuperAdmin);

    return (
        <div className="flex min-w-0 gap-2">
            <Popover open={open} onOpenChange={setOpen} modal>
                <PopoverTrigger asChild>
                    <PickTrigger icon={current?.glyph ?? Users} aria-expanded={open} {...props}>
                        {current ? (
                            <>
                                <span className="truncate">{current.name}</span>
                                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{current.meta}</span>
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
                        groups={[{ entries: [NONE] }, { heading: "Groups", entries: pickable.map(entryOf) }]}
                        value={value}
                        emptyText="Nothing matches."
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
