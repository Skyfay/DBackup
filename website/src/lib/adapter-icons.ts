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

// No npm package ships a Firebird icon - copied verbatim from
// src/components/adapter/utils.ts (main app) for pixel parity.
const firebirdIcon: IconifyIcon = {
  body: '<defs><linearGradient id="SVGtqaUweEC" x1="86.364" x2="86.364" y1="337.96" y2="7.121" gradientTransform="translate(-2.427 -1.8)scale(.37233)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f40a0b"/><stop offset="1" stop-color="#f5e710"/></linearGradient><linearGradient id="SVGGXnOQZZS" x1="216.108" x2="216.108" y1="348.988" y2="7.277" gradientTransform="translate(-2.427 -1.8)scale(.37233)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f40a0b"/><stop offset="1" stop-color="#f5e710"/></linearGradient></defs><path fill="#111" fill-rule="evenodd" d="M27.62 99.429c1.207 9.57 6.408 16.781 14.37 23.858l-2.869-1.447C16.496 112.109.68 89.617.68 63.453C.68 30.212 26.334 2.573 59.522.107C26.334 2.574.679 30.212.679 63.453C.68 30.212 26.334 2.573 59.522.107C21.509 7.613-14.923 51.524 27.62 99.43" clip-rule="evenodd"/><path fill="#111" fill-rule="evenodd" d="M114.397 43.214C111.528 22.652 95.739 8.257 66.974 0c33.938 1.501 60.719 29.488 60.719 63.453c0 35.091-26.432 62.22-60.772 63.775c-3.244.161-6.488-.402-9.651-1.394V54.258q1.568-2.372 0-4.745V34.287h3.512c-1.368-.912-2.52-1.609-3.512-2.038v-4.396c18.417 7.023 26.968 7.828 25.681 2.332c1.609 4.53.215 6.595-4.182 6.14c-5.066-.778-8.203-.43-9.436 1.071q13.632 6.756 14.557 13.11c.857 7.13-2.52 14.985-10.134 23.59c-4.798 5.978-2.305 12.331 5.442 13.35c24.047-1.18 35.788-15.95 35.199-44.232m-57.127 82.62c-7.345-2.278-13.94-6.863-17.157-10.053c-5.683-5.897-9.543-15.334-10.964-28.952c0-.08-.027-.16-.027-.241v-4.61c.885-10.938 8.176-18.632 21.929-23.055c3.11-1.528 5.2-3.083 6.219-4.665zm0-76.32c-.43-.698-1.1-1.395-1.93-2.118c-.75-.751-2.36-1.502-4.799-2.225c-5.576-.161-8.605 1.233-9.088 4.208c-9.463-4.208-9.73-9.007-.83-14.368c1.742-.67 4.289-.912 7.666-.778c-1.394-6.166.965-8.551 7.104-7.104c.644.241 1.26.483 1.877.724v4.396c-2.815-1.313-3.914-.643-3.324 2.038h3.324z" clip-rule="evenodd"/><path fill="url(#SVGtqaUweEC)" fill-rule="evenodd" d="M27.248 100.173c1.207 9.57 6.407 16.782 14.37 23.86l-2.87-1.449C16.124 112.854.308 90.362.308 64.198C.308 30.957 25.963 3.318 59.15.852C25.962 3.318.307 30.957.307 64.198c0-33.241 25.655-60.88 58.842-63.346c-38.013 7.506-74.444 51.417-31.9 99.321" clip-rule="evenodd"/><path fill="url(#SVGGXnOQZZS)" fill-rule="evenodd" d="M114.024 43.958C111.156 23.397 95.366 9.001 66.602.745c33.938 1.5 60.719 29.488 60.719 63.453c0 35.09-26.432 62.22-60.773 63.775c-3.244.16-6.487-.402-9.65-1.394V55.003q1.568-2.373 0-4.745V35.031h3.511c-1.367-.911-2.52-1.608-3.511-2.037v-4.396c18.416 7.023 26.968 7.827 25.681 2.332c1.608 4.53.215 6.594-4.182 6.139c-5.067-.778-8.203-.43-9.436 1.072q13.631 6.756 14.556 13.109c.858 7.13-2.52 14.985-10.133 23.59c-4.798 5.978-2.305 12.332 5.442 13.35c24.046-1.179 35.788-15.95 35.198-44.232m-57.126 82.62c-7.346-2.278-13.94-6.862-17.157-10.052c-5.683-5.898-9.544-15.334-10.964-28.952c0-.08-.027-.16-.027-.241v-4.611c.884-10.938 8.176-18.631 21.928-23.055c3.11-1.528 5.2-3.082 6.22-4.664zm0-76.32c-.43-.697-1.1-1.394-1.93-2.118c-.751-.75-2.36-1.501-4.8-2.225c-5.575-.16-8.604 1.233-9.087 4.209c-9.463-4.209-9.731-9.007-.83-14.369c1.742-.67 4.288-.911 7.666-.777c-1.394-6.166.965-8.552 7.104-7.104c.643.241 1.26.482 1.877.724v4.396c-2.815-1.314-3.914-.643-3.325 2.037h3.325z" clip-rule="evenodd"/>',
  width: 128,
  height: 128,
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
  firebird: firebirdIcon,
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

// These logos bake in dark navy/teal fills with no light variant, so they nearly
// disappear against the dark tinted circle used in dark mode. Brighten them via
// a CSS filter rather than swapping backgrounds, to keep the same circle look
// as every other icon.
const LOW_DARK_MODE_CONTRAST = new Set(["mysql", "mariadb", "sqlite"]);

export function needsDarkModeBoost(adapterId: string): boolean {
  return LOW_DARK_MODE_CONTRAST.has(adapterId);
}
