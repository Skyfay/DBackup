"use client";

import { createContext, useContext } from "react";
import { ServerAssignments } from "@/components/dashboard/explorer/server-assignments";
import { sharesSingleDatabases } from "@/lib/adapters/definitions";
import type { ServerSharingInfo } from "@/services/tenant/server-sharing";
import type { ConnectionKind } from "./connection-columns";
import type { AdapterConfig } from "./types";

/** What the Connections page worked out on the server, null while the card does not show. */
const SharingContext = createContext<ServerSharingInfo | null>(null);

export function ConnectionSharingProvider({ value, children }: { value: ServerSharingInfo | null; children: React.ReactNode }) {
    return <SharingContext.Provider value={value}>{children}</SharingContext.Provider>;
}

/** Whether the servers of the tenant the viewer works in share databases, for the warning before one is deleted. */
export function useConnectionSharing(): ServerSharingInfo | null {
    return useContext(SharingContext);
}

/**
 * Shared with tenants in the details of a database connection, the same cards the page of the
 * server shows in the Database Explorer: which tenant sees the backups of each of its databases, the
 * rules and who held what. They stack one under the other in the narrow room of the details.
 * Only for a server of the home tenant while there is another tenant, see `serverSharingOf`, and
 * never in All tenants, where giving a database away would change a tenant. A server of an engine
 * that gives no database alone, like Redis, shows none of it.
 */
export function ConnectionSharing({ config, kind }: { config: AdapterConfig; kind: ConnectionKind }) {
    const sharing = useContext(SharingContext);
    if (!sharing || kind !== "database" || !sharesSingleDatabases(config.adapterId)) return null;
    return <ServerAssignments key={config.id} serverId={config.id} serverName={config.name} tenantName={sharing.tenantName} canAssign={sharing.canAssign} />;
}
