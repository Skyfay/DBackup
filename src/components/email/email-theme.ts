import type { NotificationTone } from "@/lib/notifications/types";

/**
 * The colors of a notification mail: the tokens of `globals.css` as plain hex, since a mail
 * client knows neither oklch nor CSS variables. Light is written inline on every element, dark
 * comes from the classes in `darkModeCss` for the clients that follow the system, like Apple Mail.
 */

export const SANS = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export interface MailColors {
    page: string;
    card: string;
    fg: string;
    fg2: string;
    muted: string;
    faint: string;
    border: string;
    /** A tile of the strip, a shade above the card like `bg-foreground/4`. */
    tile: string;
    code: string;
    buttonBg: string;
    buttonBorder: string;
    track: string;
    destructiveText: string;
}

export const LIGHT: MailColors = {
    page: "#f4f4f5",
    card: "#ffffff",
    fg: "#09090b",
    fg2: "#3f3f46",
    muted: "#65656e",
    faint: "#a1a1aa",
    border: "#e4e4e7",
    tile: "#f5f5f5",
    code: "#f3f3f4",
    buttonBg: "#ffffff",
    buttonBorder: "#e4e4e7",
    track: "#ececee",
    destructiveText: "#c10007",
};

export const DARK: MailColors = {
    page: "#0f0f11",
    card: "#1a1a1c",
    fg: "#fafafa",
    fg2: "#d4d4d8",
    muted: "#a1a1aa",
    faint: "#71717a",
    border: "#2a2a2e",
    tile: "#232325",
    code: "#252527",
    buttonBg: "#212124",
    buttonBorder: "#313137",
    track: "#2e2e31",
    destructiveText: "#f0555a",
};

const ACCENT: Record<NotificationTone, { light: string; dark: string }> = {
    success: { light: "#15803d", dark: "#34d399" },
    failure: { light: "#e7000b", dark: "#f0555a" },
    warning: { light: "#b45309", dark: "#fbbf24" },
    neutral: { light: "#3f3f46", dark: "#d4d4d8" },
};

function rgb(hex: string): number[] {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** `fg` at strength `a` over `bg`, like `bg-destructive/5` over the card. */
export function mix(fg: string, bg: string, a: number): string {
    const f = rgb(fg);
    const b = rgb(bg);
    return `#${b.map((value, i) => Math.round(value + (f[i] - value) * a).toString(16).padStart(2, "0")).join("")}`;
}

export interface ToneColors {
    accent: string;
    /** The ground of the banner, tinted for a failure or a warning and the card otherwise. */
    tint: string;
    tintBorder: string;
    /** The ground of the icon in the banner. */
    tile: string;
    /** The stripe on the left of the banner. */
    bar: string;
}

export function toneColors(tone: NotificationTone, dark: boolean): ToneColors {
    const colors = dark ? DARK : LIGHT;
    const accent = ACCENT[tone][dark ? "dark" : "light"];
    const tinted = tone === "failure" || tone === "warning";
    if (tone === "neutral") {
        return { accent, tint: colors.card, tintBorder: colors.border, tile: mix(colors.fg, colors.card, 0.07), bar: mix(colors.muted, colors.card, 0.45) };
    }
    return {
        accent,
        tint: tinted ? mix(accent, colors.card, dark ? 0.08 : 0.05) : colors.card,
        tintBorder: tinted ? mix(accent, colors.card, dark ? 0.35 : 0.3) : colors.border,
        tile: mix(accent, colors.card, dark ? 0.16 : 0.12),
        bar: accent,
    };
}

/** The color of an icon of a tone, for the script that draws the pictures. */
export function accentOf(tone: NotificationTone, dark: boolean): string {
    return ACCENT[tone][dark ? "dark" : "light"];
}

const TONES: NotificationTone[] = ["success", "failure", "warning", "neutral"];

/**
 * The classes of the dark mode. Every element names what it is, like `m-card`, and this sheet
 * paints it dark for a client that follows the system. Gmail ignores it and darkens the mail
 * itself, Outlook on Windows ignores it and shows the light mail.
 */
export function darkModeCss(): string {
    const d = DARK;
    const rules = [
        `.m-page{background-color:${d.page}!important}`,
        `.m-card{background-color:${d.card}!important;border-color:${d.border}!important}`,
        `.m-tile{background-color:${d.tile}!important}`,
        `.m-code{background-color:${d.code}!important;color:${d.fg}!important}`,
        `.m-fg{color:${d.fg}!important}`,
        `.m-fg2{color:${d.fg2}!important}`,
        `.m-muted{color:${d.muted}!important}`,
        `.m-faint{color:${d.faint}!important}`,
        `.m-line{border-color:${d.border}!important}`,
        `.m-red{color:${d.destructiveText}!important}`,
        `.m-btn{background-color:${d.buttonBg}!important;border-color:${d.buttonBorder}!important;color:${d.fg}!important}`,
        `.m-track{background-color:${d.track}!important}`,
        `.m-light{display:none!important}`,
        `.m-dark{display:inline-block!important;max-height:none!important;overflow:visible!important}`,
        ...TONES.map((tone) => {
            const c = toneColors(tone, true);
            return [
                `.m-banner-${tone}{background-color:${c.tint}!important;border-color:${c.tintBorder}!important}`,
                `.m-bar-${tone}{background-color:${c.bar}!important}`,
                `.m-icon-${tone}{background-color:${c.tile}!important}`,
                `.m-fill-${tone}{background-color:${c.accent}!important}`,
            ].join("");
        }),
    ];
    return `@media (prefers-color-scheme: dark){${rules.join("")}}`;
}
