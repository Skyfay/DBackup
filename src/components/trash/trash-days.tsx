"use client";

import { createContext, useContext } from "react";
import { getDataRetentionSetting } from "@/lib/core/data-retention";

const TrashDaysContext = createContext(getDataRetentionSetting("deletedItems")?.defaultDays ?? 30);

/**
 * How long Recently deleted keeps a record, from Data retention, for the delete dialogs of every
 * page. The dashboard layout provides it, and outside a provider it is the default.
 */
export function TrashDaysProvider({ days, children }: { days: number; children: React.ReactNode }) {
    return <TrashDaysContext.Provider value={days}>{children}</TrashDaysContext.Provider>;
}

export function useTrashDays(): number {
    return useContext(TrashDaysContext);
}
