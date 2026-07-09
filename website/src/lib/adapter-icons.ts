import type { IconifyIcon } from "@iconify/react";

// SVG Logos (multi-colored, color baked into the SVG)
import mysqlIcon from "@iconify-icons/logos/mysql-icon";
import mariadbIcon from "@iconify-icons/logos/mariadb-icon";
import postgresqlIcon from "@iconify-icons/logos/postgresql";
import mongodbIcon from "@iconify-icons/logos/mongodb-icon";
import sqliteIcon from "@iconify-icons/logos/sqlite";
import redisIcon from "@iconify-icons/logos/redis";
import awsIcon from "@iconify-icons/logos/aws";
import cloudflareIcon from "@iconify-icons/logos/cloudflare-icon";
import googleDriveIcon from "@iconify-icons/logos/google-drive";
import dropboxIcon from "@iconify-icons/logos/dropbox";
import onedriveIcon from "@iconify-icons/logos/microsoft-onedrive";
import discordIcon from "@iconify-icons/logos/discord-icon";
import slackIcon from "@iconify-icons/logos/slack-icon";
import teamsIcon from "@iconify-icons/logos/microsoft-teams";
import telegramIcon from "@iconify-icons/logos/telegram";

// Simple Icons (monochrome - brand color applied via getAdapterColor)
import mssqlIcon from "@iconify-icons/simple-icons/microsoftsqlserver";
import minioIcon from "@iconify-icons/simple-icons/minio";
import hetznerIcon from "@iconify-icons/simple-icons/hetzner";

// Material Design Icons (protocol/generic - no branded npm icon exists)
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

// No npm package ships a Valkey icon - copied verbatim from
// src/components/adapter/utils.ts (main app) for pixel parity.
const valkeyIcon: IconifyIcon = {
  body: '<path fill="#123678" fill-rule="evenodd" d="m126.1 431.2l-91.7-57.4V128.6L258.7 0l218.9 128.8v258L255.2 512L178 463.7V346.2L136.2 320V187l121.2-69.5l118.4 69.7v139.4L282 379.4v-56.1c28.1-10.8 48.3-38.6 48.3-71.5c0-42.3-33.5-76.3-74.3-76.3s-74.3 34-74.3 76.3c0 32.8 20.2 60.6 48.3 71.5v106.3l26.8 16.8l164.4-92.6V161.1L258.3 65.3l-167.5 96v181.3l35.3 22.1zM256 216.7c18.5 0 33.1 15.9 33.1 35.1c0 19.1-14.6 35.1-33.1 35.1s-33.1-15.9-33.1-35.1s14.6-35.1 33.1-35.1"/>',
  width: 512,
  height: 512,
};

const ADAPTER_ICON_MAP: Record<string, IconifyIcon> = {
  // Databases
  mysql: mysqlIcon,
  mariadb: mariadbIcon,
  postgres: postgresqlIcon,
  mongodb: mongodbIcon,
  sqlite: sqliteIcon,
  redis: redisIcon,
  valkey: valkeyIcon,
  mssql: mssqlIcon,
  // Storage
  "local-filesystem": harddiskIcon,
  "s3-aws": awsIcon,
  "s3-generic": minioIcon,
  "s3-r2": cloudflareIcon,
  "s3-hetzner": hetznerIcon,
  "google-drive": googleDriveIcon,
  dropbox: dropboxIcon,
  onedrive: onedriveIcon,
  sftp: sshIcon,
  ftp: swapVerticalIcon,
  webdav: cloudUploadIcon,
  smb: folderNetworkIcon,
  rsync: folderSyncIcon,
  // Notifications
  discord: discordIcon,
  slack: slackIcon,
  teams: teamsIcon,
  "generic-webhook": webhookIcon,
  gotify: bellRingIcon,
  ntfy: messageTextIcon,
  telegram: telegramIcon,
  "twilio-sms": cellphoneMessageIcon,
  email: emailIcon,
};

export function getAdapterIcon(adapterId: string): IconifyIcon {
  return ADAPTER_ICON_MAP[adapterId] ?? discIcon;
}

// Brand colors for monochrome simple-icons entries only
// (logos:* icons already have colors embedded in their SVGs)
const ADAPTER_COLOR_MAP: Record<string, string> = {
  mssql: "#CC2927",
  "s3-generic": "#C72E49",
  "s3-hetzner": "#D50C2D",
};

export function getAdapterColor(adapterId: string): string | undefined {
  return ADAPTER_COLOR_MAP[adapterId];
}
