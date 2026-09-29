/**
 * The browser, system and kind of device a session or a sign-in came from, read from its user
 * agent, and an IP address in a form people can read. Shared by the sessions of the profile and
 * the Users page, so it runs on the server and in the browser alike.
 */

export type BrowserName = "Chrome" | "Brave" | "Firefox" | "Safari" | "Edge" | "Opera" | "Vivaldi" | "Arc" | "Tor Browser" | "Internet Explorer" | "Unknown";
export type OsName = "Windows" | "macOS" | "Linux" | "Android" | "iOS" | "Chrome OS" | "Unknown";
export type DeviceKind = "desktop" | "mobile" | "tablet";

export interface UserAgentInfo {
    browser: BrowserName;
    os: OsName;
    device: DeviceKind;
}

export function parseUserAgent(ua: string | null | undefined): UserAgentInfo {
    if (!ua) return { browser: "Unknown", os: "Unknown", device: "desktop" };

    let os: OsName = "Unknown";
    if (ua.includes("Windows")) os = "Windows";
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
    else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) os = "macOS";
    else if (ua.includes("CrOS")) os = "Chrome OS";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("Linux")) os = "Linux";

    // Specific browsers before the generic Chrome and Safari, whose names the others carry too.
    let browser: BrowserName = "Unknown";
    if (ua.includes("Firefox/")) browser = "Firefox";
    else if (ua.includes("Edg/")) browser = "Edge";
    else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
    else if (ua.includes("Vivaldi/")) browser = "Vivaldi";
    else if (ua.includes("Brave")) browser = "Brave";
    else if (ua.includes("Arc/")) browser = "Arc";
    else if (ua.includes("Tor Browser") || ua.includes("TorBrowser")) browser = "Tor Browser";
    else if (ua.includes("Chrome/") && ua.includes("Safari/")) browser = "Chrome";
    else if (ua.includes("Safari/") && !ua.includes("Chrome")) browser = "Safari";
    else if (ua.includes("Trident/") || ua.includes("MSIE")) browser = "Internet Explorer";

    let device: DeviceKind = "desktop";
    if (ua.includes("iPad") || ua.includes("Tablet")) device = "tablet";
    else if (ua.includes("Mobile") || ua.includes("iPhone") || (ua.includes("Android") && !ua.includes("Tablet"))) device = "mobile";

    return { browser, os, device };
}

/** "Firefox on macOS", or whichever half is known, or null when neither is. */
export function describeAgent(info: UserAgentInfo): string | null {
    const browser = info.browser === "Unknown" ? null : info.browser;
    const os = info.os === "Unknown" ? null : info.os;
    if (browser && os) return `${browser} on ${os}`;
    return browser ?? os;
}

export function formatIpAddress(ip: string | null | undefined): string {
    if (!ip) return "";
    // The all zeros IPv6 address, which Better Auth writes out in full.
    if (/^0{1,4}(:0{1,4}){7}$/.test(ip) || ip === "::") return "localhost";
    if (/^0{1,4}(:0{1,4}){6}:0{0,3}1$/.test(ip) || ip === "::1") return "localhost";
    // Drops the leading zeros of each group and folds the first run of zero groups.
    if (ip.includes(":") && !ip.includes(".")) {
        const groups = ip.split(":").map((group) => group.replace(/^0+/, "") || "0");
        return groups.join(":").replace(/(?:^|:)0(?::0)*(?::|$)/, "::");
    }
    return ip;
}
