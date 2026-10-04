import { Bell, Database, FolderTree, HardDrive, type LucideIcon } from "lucide-react";
import type { ConnectionKind } from "./connection-columns";

/** What an empty tab says, with the icon of its tab and the label of its New button. */
export const EMPTY_TABS: Record<ConnectionKind, { icon: LucideIcon; title: string; description: string; action: string }> = {
    database: {
        icon: Database,
        title: "No databases yet",
        description: "A database connection tells DBackup where a server runs and how to sign in, so a job can back it up.",
        action: "New database",
    },
    source: {
        icon: FolderTree,
        title: "No directory sources yet",
        description: "A directory source is a folder on a server, a share or a Docker volume that a job backs up.",
        action: "New directory source",
    },
    destination: {
        icon: HardDrive,
        title: "No destinations yet",
        description: "A destination keeps the backups, on S3, an SFTP server, a share, a cloud drive or a local disk.",
        action: "New destination",
    },
    notification: {
        icon: Bell,
        title: "No channels yet",
        description: "A channel tells you how backups went, by email or in Discord, Slack, Teams and more.",
        action: "New channel",
    },
};
