"use client";

import { createContext, useContext } from "react";
import { TABLE_DEFAULTS, type TableDefaults } from "@/lib/core/table-preferences";

/** The rows per page and the row height of the viewer's profile, as the dashboard layout read them. */
const TableDefaultsContext = createContext<TableDefaults>(TABLE_DEFAULTS);

export function TableDefaultsProvider({ defaults, children }: { defaults: TableDefaults; children: React.ReactNode }) {
    return <TableDefaultsContext.Provider value={defaults}>{children}</TableDefaultsContext.Provider>;
}

/**
 * How a table starts: the rows per page and the row height the viewer set in the profile. A
 * table with a column layout keeps its own once the viewer changed them there. Outside the
 * dashboard, like in a test, the defaults DBackup ships with.
 */
export function useTableDefaults(): TableDefaults {
    return useContext(TableDefaultsContext);
}
