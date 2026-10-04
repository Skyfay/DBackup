"use client";

import { Pencil } from "lucide-react";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DateDisplay } from "@/components/utils/date-display";
import { usePageModel } from "@/hooks/use-page-model";
import type { UserDetails as UserDetailsModel, UserRow, UsersGroup } from "@/services/user/users-types";
import { GroupTag, UserAvatar, YouTag } from "./user-cells";
import { AccessSection, ActivitySection, ApiKeysSection, SessionsSection, SignInSection } from "./user-details-sections";

interface UserDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    user: UserRow | null;
    groups: UsersGroup[];
    onClose: () => void;
    /** Each is absent when the viewer may not do it to this user. */
    onEdit?: (user: UserRow) => void;
    onPassword?: (user: UserRow) => void;
    onResetTwoFactor?: (user: UserRow) => void;
    onSignOut?: (user: UserRow) => void;
    /** The rest of what the user can have done to them, as the menu of the row shows it. */
    groupsMenu: BackupActionGroup[];
    /** Runs after something in the panel changed the user, so the list follows. */
    onChanged: () => void;
    /** Bumped after a change elsewhere, so the panel loads again. */
    version: number;
}

/**
 * Everything about one user in a panel from the right: what their group lets them do, how they
 * sign in, the browsers signed in as them, their API keys and what they did last.
 */
export function UserDetails(props: UserDetailsProps) {
    const { open, user, onClose } = props;
    return (
        <Sheet open={open && user !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {user && <Content {...props} user={user} />}
            </SheetContent>
        </Sheet>
    );
}

function Content({ user, groups, onEdit, onPassword, onResetTwoFactor, onSignOut, groupsMenu, onChanged, version }: UserDetailsProps & { user: UserRow }) {
    // The version is part of the address, so a change elsewhere loads the panel again.
    const { model: details, refresh } = usePageModel<UserDetailsModel>(`/api/users/${encodeURIComponent(user.id)}?v=${version}`, "The user could not be loaded.");
    // A panel that still shows the user before holds nothing about this one.
    const shown = details?.id === user.id ? details : null;

    const changed = () => {
        void refresh();
        onChanged();
    };

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <UserAvatar user={user} size="lg" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <SheetTitle className="truncate text-lg font-semibold">{user.name}</SheetTitle>
                            <GroupTag group={user.group} />
                            {user.isYou && <YouTag />}
                        </div>
                        <SheetDescription className="truncate text-sm text-muted-foreground">
                            {user.email} · since <DateDisplay date={user.createdAt} format="P" />
                        </SheetDescription>
                    </div>
                </div>
                {(onEdit || groupsMenu.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {onEdit && (
                            <Button variant="outline" size="sm" onClick={() => onEdit(user)}>
                                <Pencil />
                                Edit
                            </Button>
                        )}
                        {groupsMenu.length > 0 && <BackupRowMenu name={user.name} groups={groupsMenu} variant="outline" align="start" />}
                    </div>
                )}
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    <AccessSection user={user} groups={groups} onChangeGroup={onEdit && !user.isYou ? () => onEdit(user) : undefined} />
                    <SignInSection
                        user={user}
                        details={shown}
                        onPassword={onPassword && !user.isYou ? () => onPassword(user) : undefined}
                        onResetTwoFactor={onResetTwoFactor ? () => onResetTwoFactor(user) : undefined}
                    />
                    <SessionsSection user={user} details={shown} onSignOutAll={onSignOut ? () => onSignOut(user) : undefined} onChanged={changed} />
                    <ApiKeysSection user={user} details={shown} />
                    <ActivitySection details={shown} />
                </div>
            </ScrollArea>
        </>
    );
}
