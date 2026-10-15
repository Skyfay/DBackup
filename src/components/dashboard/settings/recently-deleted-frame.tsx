"use client";

import { useMemo } from "react";
import type { TrashPart } from "@/services/trash/trash-types";
import { RecentlyDeletedPart } from "./recently-deleted-part";
import { SettingsFrameContext, useSettingsFrame } from "./settings-frame";
import { RECENTLY_DELETED_PART } from "./settings-parts";

const READ_ONLY_NOTE = "You may look at what was deleted. Restoring it or deleting it for good needs a group that may change the tenant settings.";

interface RecentlyDeletedFrameProps {
    trash: TrashPart;
    /** Every tenant at once, read only, since an entry comes back in its own tenant. */
    allTenants?: boolean;
}

/**
 * Recently deleted as a part of Settings with one tenant, or of the tenant settings with more. It
 * follows rights of its own, not the ones of the page around it: whoever may read the tenant
 * settings sees it, and whoever may change them restores and deletes for good.
 */
export function RecentlyDeletedFrame({ trash, allTenants = false }: RecentlyDeletedFrameProps) {
    const { setDirty } = useSettingsFrame();
    const frame = useMemo(() => ({
        // All tenants says in a line of its own why nothing can be restored there.
        readOnly: !trash.canManage && !allTenants,
        setDirty,
        describe: () => RECENTLY_DELETED_PART,
        readOnlyNote: READ_ONLY_NOTE,
    }), [trash.canManage, allTenants, setDirty]);

    return (
        <SettingsFrameContext.Provider value={frame}>
            <RecentlyDeletedPart rows={trash.rows} allTenants={allTenants} />
        </SettingsFrameContext.Provider>
    );
}

/**
 * What was deleted in every tenant, below the pick of a tenant on the tenant settings of All
 * tenants. It only reads, each row opens its tenant to restore it or delete it for good.
 */
export function RecentlyDeletedEveryTenant({ trash }: { trash: TrashPart }) {
    return (
        <div className="flex min-w-0 flex-col overflow-clip rounded-xl border bg-card text-card-foreground shadow-sm">
            <RecentlyDeletedFrame trash={trash} allTenants />
        </div>
    );
}
