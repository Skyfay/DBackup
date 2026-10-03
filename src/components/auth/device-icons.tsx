"use client";

import { Icon, type IconifyIcon } from "@iconify/react";
// Bundled with the app, so they show without a connection to the internet.
import chromeIcon from "@iconify-icons/logos/chrome";
import braveIcon from "@iconify-icons/logos/brave";
import firefoxIcon from "@iconify-icons/logos/firefox";
import safariIcon from "@iconify-icons/logos/safari";
import edgeIcon from "@iconify-icons/logos/microsoft-edge";
import operaIcon from "@iconify-icons/logos/opera";
import vivaldiIcon from "@iconify-icons/logos/vivaldi-icon";
import arcIcon from "@iconify-icons/simple-icons/arc";
import torIcon from "@iconify-icons/simple-icons/torbrowser";
import appleIcon from "@iconify-icons/logos/apple";
import windowsIcon from "@iconify-icons/logos/microsoft-windows-icon";
import linuxIcon from "@iconify-icons/logos/linux-tux";
import androidIcon from "@iconify-icons/logos/android-icon";
import monitorIcon from "@iconify-icons/mdi/monitor";
import cellphoneIcon from "@iconify-icons/mdi/cellphone";
import tabletIcon from "@iconify-icons/mdi/tablet";
import webIcon from "@iconify-icons/mdi/web";
import type { BrowserName, DeviceKind, OsName } from "@/lib/core/user-agent";
import { cn } from "@/lib/utils";

const BROWSER_ICONS: Partial<Record<BrowserName, { icon: IconifyIcon; color?: string }>> = {
    Chrome: { icon: chromeIcon },
    Brave: { icon: braveIcon },
    Firefox: { icon: firefoxIcon },
    Safari: { icon: safariIcon },
    Edge: { icon: edgeIcon },
    Opera: { icon: operaIcon },
    Vivaldi: { icon: vivaldiIcon },
    Arc: { icon: arcIcon, color: "#0085FF" },
    "Tor Browser": { icon: torIcon, color: "#7D4698" },
};

const OS_ICONS: Partial<Record<OsName, { icon: IconifyIcon; darkInvert?: boolean }>> = {
    macOS: { icon: appleIcon, darkInvert: true },
    iOS: { icon: appleIcon, darkInvert: true },
    Windows: { icon: windowsIcon },
    Linux: { icon: linuxIcon },
    Android: { icon: androidIcon },
};

const DEVICE_ICONS: Record<DeviceKind, IconifyIcon> = {
    desktop: monitorIcon,
    mobile: cellphoneIcon,
    tablet: tabletIcon,
};

/** The logo of a browser, or the kind of device when the browser is not known. */
export function BrowserIcon({ browser, device, className }: { browser: BrowserName; device: DeviceKind; className?: string }) {
    const entry = BROWSER_ICONS[browser];
    if (entry) {
        return <Icon icon={entry.icon} className={cn("size-5", className)} aria-hidden="true" {...(entry.color ? { style: { color: entry.color } } : {})} />;
    }
    return <Icon icon={DEVICE_ICONS[device] ?? webIcon} className={cn("size-5 text-muted-foreground", className)} aria-hidden="true" />;
}

/** The logo of an operating system, nothing for one that is not known. */
export function OsIcon({ os, className }: { os: OsName; className?: string }) {
    const entry = OS_ICONS[os];
    if (!entry) return null;
    return <Icon icon={entry.icon} className={cn("size-3.5", entry.darkInvert && "dark:invert", className)} aria-hidden="true" />;
}
