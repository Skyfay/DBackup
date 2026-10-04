import type { NotificationIcon, NotificationTone } from "@/lib/notifications/types";

/**
 * Every picture a notification mail shows. A mail client draws no SVG and loads nothing from an
 * instance on a private network, so the pictures are PNGs on the docs site, drawn from the same
 * lucide icons and adapter logos as the app by `scripts/build-email-icons.ts`. A light and a dark
 * one each, the mail swaps them with its dark mode. A new pair here needs that script run once.
 */

export const EMAIL_ASSETS = "https://docs.dbackup.app/email";
export const EMAIL_LOGO = "https://docs.dbackup.app/logo.png";

/** The icons of the banner in the tones the templates give them. */
export const BANNER_ICONS: Record<NotificationTone, NotificationIcon[]> = {
    success: ["circle-check", "file-cog", "plug", "mail"],
    failure: ["circle-x", "unplug", "shield-alert"],
    warning: ["triangle-alert", "trending-up", "hard-drive", "clock-alert"],
    neutral: ["unplug", "circle-arrow-up", "log-in", "user-round-plus"],
};

/** Gray icons, on the buttons and in the box of a note. */
export const MUTED_ICONS = [
    "history", "calendar-clock", "database", "settings", "user-round", "users", "external-link", "archive", "log-in", "shield-check",
] as const;

export type MutedIcon = typeof MUTED_ICONS[number];

/** The outcome of a destination, by the lucide icon and the tone it is drawn in. */
export const STATE_ICONS = {
    ok: { icon: "circle-check", tone: "success" },
    failed: { icon: "circle-x", tone: "failure" },
    skipped: { icon: "circle-minus", tone: "faint" },
} as const;

/** The logos of the destinations, from the packages `components/adapter/utils.ts` uses. */
export const ADAPTER_LOGOS: Record<string, { pack: "logos" | "simple-icons" | "mdi"; name: string; color?: string }> = {
    "local-filesystem": { pack: "mdi", name: "harddisk" },
    "docker-volume": { pack: "logos", name: "docker-icon" },
    "s3-aws": { pack: "logos", name: "aws" },
    "s3-generic": { pack: "simple-icons", name: "minio", color: "#C72E49" },
    "s3-r2": { pack: "logos", name: "cloudflare-icon" },
    "s3-hetzner": { pack: "simple-icons", name: "hetzner", color: "#D50C2D" },
    "google-drive": { pack: "logos", name: "google-drive" },
    "dropbox": { pack: "logos", name: "dropbox" },
    "onedrive": { pack: "logos", name: "microsoft-onedrive" },
    "sftp": { pack: "mdi", name: "ssh" },
    "ftp": { pack: "mdi", name: "swap-vertical" },
    "webdav": { pack: "mdi", name: "cloud-upload" },
    "smb": { pack: "mdi", name: "folder-network" },
    "rsync": { pack: "mdi", name: "folder-sync" },
};

type Theme = "light" | "dark";

export const assetUrl = {
    banner: (icon: NotificationIcon, tone: NotificationTone, theme: Theme) => `${EMAIL_ASSETS}/banner-${icon}-${tone}-${theme}.png`,
    muted: (icon: MutedIcon, theme: Theme) => `${EMAIL_ASSETS}/muted-${icon}-${theme}.png`,
    state: (state: keyof typeof STATE_ICONS, theme: Theme) => `${EMAIL_ASSETS}/state-${state}-${theme}.png`,
    adapter: (adapterId: string, theme: Theme) => ADAPTER_LOGOS[adapterId] ? `${EMAIL_ASSETS}/adapter-${adapterId}-${theme}.png` : null,
};

/** The banner icon a payload asks for, or the one of its tone when the pair has no picture. */
export function bannerIcon(icon: NotificationIcon | undefined, tone: NotificationTone): NotificationIcon {
    if (icon && BANNER_ICONS[tone].includes(icon)) return icon;
    return { success: "circle-check", failure: "circle-x", warning: "triangle-alert", neutral: "circle-arrow-up" }[tone] as NotificationIcon;
}

export function isMutedIcon(icon: string): icon is MutedIcon {
    return (MUTED_ICONS as readonly string[]).includes(icon);
}
