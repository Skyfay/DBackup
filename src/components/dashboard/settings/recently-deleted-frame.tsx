"use client";

import { useMemo } from "react";
import type { TrashPart } from "@/services/trash/trash-types";
import { RecentlyDeletedPart } from "./recently-deleted-part";
import { SettingsFrameContext, useSettingsFrame } from "./settings-frame";
import { RECENTLY_DELETED_PART } from "./settings-parts";

const READ_ONLY_NOTE = "You may look at what was deleted. Restoring it or deleting it for good needs a group that may change the tenant settings.";

/**
 * Recently deleted as a part of Settings with one tenant, or of the tenant settings with more. It
 * follows rights of its own, not the ones of the page around it: whoever may read the tenant
 * settings sees it, and whoever may change them restores and deletes for good.
 */
export function RecentlyDeletedFrame({ trash }: { trash: TrashPart }) {
    const { setDirty } = useSettingsFrame();
    const frame = useMemo(() => ({
        readOnly: !trash.canManage,
        setDirty,
        describe: () => RECENTLY_DELETED_PART,
        readOnlyNote: READ_ONLY_NOTE,
    }), [trash.canManage, setDirty]);

    return (
        <SettingsFrameContext.Provider value={frame}>
            <RecentlyDeletedPart rows={trash.rows} />
        </SettingsFrameContext.Provider>
    );
}
