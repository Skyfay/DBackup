import { kindNames } from "@/components/adapter/connection-columns";
import { CONNECTION_TABS } from "@/components/adapter/connections-tabs";
import type { VaultConnection, VaultConnectionRole, VaultCredential, VaultKey } from "@/services/vault/vault-types";

/** "1 backup", "3 backups". */
export function count(value: number, noun: string, plural = `${noun}s`): string {
    return `${value.toLocaleString()} ${value === 1 ? noun : plural}`;
}

const ROLES: Record<VaultConnectionRole, string> = {
    database: "Database",
    source: "Directory source",
    destination: "Destination",
    notification: "Notifications",
};

const TABS: Record<VaultConnectionRole, string> = {
    database: CONNECTION_TABS.DATABASES,
    source: CONNECTION_TABS.DIRECTORY_SOURCES,
    destination: CONNECTION_TABS.DESTINATIONS,
    notification: CONNECTION_TABS.NOTIFICATIONS,
};

/** What a connection is and how it uses the profile, like "Destination · SFTP" or "Database · MySQL, its SSH server". */
export function connectionKind(connection: VaultConnection): string {
    const kind = `${ROLES[connection.role]} · ${kindNames.get(connection.adapterId) ?? connection.adapterId}`;
    return connection.slot === "ssh" ? `${kind}, its SSH server` : kind;
}

/** The Connections page on the tab of the connection, with its details open. */
export function connectionHref(connection: Pick<VaultConnection, "id" | "role">): string {
    return `/dashboard/connections?tab=${TABS[connection.role]}&open=${encodeURIComponent(connection.id)}`;
}

/** The names of the first connections or jobs and how many more, like "SkyNas SMB, Photos share +3". */
export function namesOf(names: string[], shown = 2): { text: string; more: number } {
    return { text: names.slice(0, shown).join(", "), more: Math.max(0, names.length - shown) };
}

export type CredentialQuick = "all" | "used" | "unused";

export function matchesCredential(profile: VaultCredential, quick: CredentialQuick): boolean {
    if (quick === "used") return profile.usedBy.length > 0;
    if (quick === "unused") return profile.usedBy.length === 0;
    return true;
}

/** Why a profile cannot be deleted yet, or null. The server refuses it the same way. */
export function credentialBlocker(profile: VaultCredential): string | null {
    const used = profile.usedBy.length;
    return used > 0 ? `${count(used, "connection")} log${used === 1 ? "s" : ""} in with it` : null;
}

export type KeyQuick = "all" | "used" | "kitless";

/** Why a key cannot be deleted yet, or null. The server refuses it the same way. */
export function keyBlocker(key: Pick<VaultKey, "jobs" | "configBackup">): string | null {
    const users = [...(key.jobs.length > 0 ? [count(key.jobs.length, "job")] : []), ...(key.configBackup ? ["the config backup"] : [])];
    if (users.length === 0) return null;
    return `${users.join(" and ")} ${key.jobs.length > 1 || users.length > 1 ? "encrypt" : "encrypts"} with it`;
}

/** "3 jobs · 214 backups", what a key does in one line. */
export function keyUse(key: VaultKey): string {
    const parts = [
        ...(key.jobs.length > 0 ? [count(key.jobs.length, "job")] : []),
        ...(key.configBackup ? ["config backup"] : []),
        count(key.backups, "backup"),
    ];
    return parts.join(" · ");
}
