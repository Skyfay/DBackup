/**
 * Adapter icon mapping — bundled Iconify icon data.
 *
 * Icons are imported directly from tree-shakeable @iconify-icons/* packages
 * so they work offline without API calls (important for self-hosted deployments).
 *
 * - @iconify-icons/logos         → SVG Logos (multi-colored brand icons)
 * - @iconify-icons/simple-icons  → Simple Icons (monochrome, brand color applied)
 * - @iconify-icons/mdi           → Material Design Icons (protocol, storage & generic icons)
 */

import type { IconifyIcon } from "@iconify/react";

// — SVG Logos (primary, multi-colored) —
import mysqlIcon from "@iconify-icons/logos/mysql-icon";
import mariadbIcon from "@iconify-icons/logos/mariadb-icon";
import postgresqlIcon from "@iconify-icons/logos/postgresql";
import mongodbIcon from "@iconify-icons/logos/mongodb-icon";
import sqliteIcon from "@iconify-icons/logos/sqlite";
import redisIcon from "@iconify-icons/logos/redis";
import awsS3Icon from "@iconify-icons/logos/aws-s3";
import cloudflareIcon from "@iconify-icons/logos/cloudflare-icon";
import googleDriveIcon from "@iconify-icons/logos/google-drive";
import dropboxIcon from "@iconify-icons/logos/dropbox";
import onedriveIcon from "@iconify-icons/logos/microsoft-onedrive";
import discordIcon from "@iconify-icons/logos/discord-icon";
import slackIcon from "@iconify-icons/logos/slack-icon";
import teamsIcon from "@iconify-icons/logos/microsoft-teams";
import telegramIcon from "@iconify-icons/logos/telegram";

// — Simple Icons (fallback for brands not in SVG Logos) —
import mssqlIcon from "@iconify-icons/simple-icons/microsoftsqlserver";
import minioIcon from "@iconify-icons/simple-icons/minio";
import hetznerIcon from "@iconify-icons/simple-icons/hetzner";

// — Material Design Icons (protocol, storage & generic icons) —
import harddiskIcon from "@iconify-icons/mdi/harddisk";
import sshIcon from "@iconify-icons/mdi/ssh";
import swapVerticalIcon from "@iconify-icons/mdi/swap-vertical";
import cloudUploadIcon from "@iconify-icons/mdi/cloud-upload";
import folderNetworkIcon from "@iconify-icons/mdi/folder-network";
import folderSyncIcon from "@iconify-icons/mdi/folder-sync";
import emailIcon from "@iconify-icons/mdi/email";
import webhookIcon from "@iconify-icons/mdi/webhook";
import bellRingIcon from "@iconify-icons/mdi/bell-ring";
import messageTextIcon from "@iconify-icons/mdi/message-text";
import cellphoneMessageIcon from "@iconify-icons/mdi/cellphone-message";
import discIcon from "@iconify-icons/mdi/disc";

// Map adapter IDs to bundled IconifyIcon data objects
const ADAPTER_ICON_MAP: Record<string, IconifyIcon> = {
    // Databases
    "mysql": mysqlIcon,
    "mariadb": mariadbIcon,
    "postgres": postgresqlIcon,
    "mongodb": mongodbIcon,
    "sqlite": sqliteIcon,
    "redis": redisIcon,
    "mssql": mssqlIcon,

    // Storage — Local
    "local-filesystem": harddiskIcon,

    // Storage — S3
    "s3-aws": awsS3Icon,
    "s3-generic": minioIcon,
    "s3-r2": cloudflareIcon,
    "s3-hetzner": hetznerIcon,

    // Storage — Cloud Drives
    "google-drive": googleDriveIcon,
    "dropbox": dropboxIcon,
    "onedrive": onedriveIcon,

    // Storage — Network
    "sftp": sshIcon,
    "ftp": swapVerticalIcon,
    "webdav": cloudUploadIcon,
    "smb": folderNetworkIcon,
    "rsync": folderSyncIcon,

    // Notifications
    "discord": discordIcon,
    "slack": slackIcon,
    "teams": teamsIcon,
    "generic-webhook": webhookIcon,
    "gotify": bellRingIcon,
    "ntfy": messageTextIcon,
    "telegram": telegramIcon,
    "twilio-sms": cellphoneMessageIcon,
    "email": emailIcon,
};

/** Returns the bundled Iconify icon data for a given adapter ID */
export function getAdapterIcon(adapterId: string): IconifyIcon {
    return ADAPTER_ICON_MAP[adapterId] ?? discIcon;
}

// Brand colors for monochrome simple-icons entries only
// (logos:* icons already have colors embedded in their SVGs)
const ADAPTER_COLOR_MAP: Record<string, string> = {
    "mssql": "#CC2927",
    "s3-generic": "#C72E49",
    "s3-hetzner": "#D50C2D",
};

export function getAdapterColor(adapterId: string): string | undefined {
    return ADAPTER_COLOR_MAP[adapterId];
}
