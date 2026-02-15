
import { Database, Folder, Mail, Disc, Network, Globe, Cloud, HardDrive, MessageSquare } from "lucide-react";
import {
    SiMysql,
    SiMariadb,
    SiPostgresql,
    SiMongodb,
    SiSqlite,
    SiRedis,
    SiCloudflare,
    SiHetzner,
    SiGoogledrive,
    SiDropbox,
    SiMinio,
    SiDiscord,
} from "@icons-pack/react-simple-icons";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;

// Map adapter IDs to their brand icons (Simple Icons) or Lucide fallbacks
const ADAPTER_ICON_MAP: Record<string, IconComponent> = {
    // Databases
    "mysql": SiMysql,
    "mariadb": SiMariadb,
    "postgres": SiPostgresql,
    "mongodb": SiMongodb,
    "sqlite": SiSqlite,
    "redis": SiRedis,
    "mssql": Database,

    // Storage — Local
    "local-filesystem": Folder,

    // Storage — S3
    "s3-aws": Cloud,
    "s3-generic": SiMinio,
    "s3-r2": SiCloudflare,
    "s3-hetzner": SiHetzner,

    // Storage — Cloud Drives
    "google-drive": SiGoogledrive,
    "dropbox": SiDropbox,
    "onedrive": Cloud,

    // Storage — Network
    "sftp": Network,
    "ftp": Network,
    "webdav": Globe,
    "smb": Network,
    "rsync": Network,

    // Notifications
    "discord": SiDiscord,
    "email": Mail,
};

export function getAdapterIcon(adapterId: string): IconComponent {
    return ADAPTER_ICON_MAP[adapterId] ?? Disc;
}

// Brand color hex values for Simple Icons (used for colored rendering)
const ADAPTER_COLOR_MAP: Record<string, string> = {
    "mysql": "#4479A1",
    "mariadb": "#003545",
    "postgres": "#4169E1",
    "mongodb": "#47A248",
    "sqlite": "#003B57",
    "redis": "#DC382D",
    "s3-r2": "#F38020",
    "s3-hetzner": "#D50C2D",
    "google-drive": "#4285F4",
    "dropbox": "#0061FF",
    "discord": "#5865F2",
    "s3-generic": "#C72E49",
};

export function getAdapterColor(adapterId: string): string | undefined {
    return ADAPTER_COLOR_MAP[adapterId];
}

// Legacy fallback for external consumers that import by category
export { Database, Folder, HardDrive, MessageSquare, Mail, Disc, Network, Globe, Cloud };
