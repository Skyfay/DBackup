/**
 * Whether a request comes from a Mac, iPhone or iPad, whose keyboards say ⌘ where others say Ctrl.
 * Chromium browsers name the platform in `Sec-CH-UA-Platform`, the others only in the user agent.
 */
export function usesAppleKeys(requestHeaders: { get(name: string): string | null }): boolean {
    const platform = requestHeaders.get("sec-ch-ua-platform");
    if (platform) return /^"?(macOS|iOS)"?$/i.test(platform.trim());
    return /Macintosh|Mac OS X|iPhone|iPad/i.test(requestHeaders.get("user-agent") ?? "");
}
