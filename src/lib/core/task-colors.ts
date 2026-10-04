import { z } from "zod";

/**
 * The colors of the tasks a person picks in their profile: what adds, edits, picks, filters, warns,
 * deletes and reports success. Each is a family with a shade for the light and one for the dark
 * theme, or an own color whose dark shade is worked out here. The dashboard layout turns a choice
 * into CSS variables for the whole app, `taskColorCss`, and the Colors part previews one with
 * `taskColorVars`. Warning, Delete and Success color the run statuses too. Running stays blue.
 */

export const TASK_COLOR_KEYS = ["create", "edit", "pick", "filter", "warning", "destructive", "success"] as const;

export type TaskColorKey = (typeof TASK_COLOR_KEYS)[number];

export const TASK_COLOR_LABELS: Record<TaskColorKey, string> = {
    create: "Add",
    edit: "Edit",
    pick: "Pick",
    filter: "Filter",
    warning: "Warning",
    destructive: "Delete",
    success: "Success",
};

/** Where a person sees each color, in the words of the Colors part. */
export const TASK_COLOR_WHERE: Record<TaskColorKey, string> = {
    create: "New buttons, dialogs that add, Clone",
    edit: "Edit dialogs and the menu entries that open them",
    pick: "Fields that pick a saved entry, the folder and file browsers",
    filter: "The filters of every table",
    warning: "Save anyway, Restore, partial runs, what failed in a bulk action",
    destructive: "Delete, Remove, Revoke, failed runs",
    success: "All is well, runs that completed",
};

interface Shades {
    /** On white and the gray page. */
    light: string;
    /** On the dark cards. */
    dark: string;
}

/**
 * The families a task can take. Blue, violet, cyan, fuchsia, amber, red and green are exactly the
 * colors of `globals.css`, so the default changes nothing.
 */
export const COLOR_FAMILIES = {
    blue: { light: "#2563eb", dark: "#60a5fa" },
    violet: { light: "#7c3aed", dark: "#a78bfa" },
    cyan: { light: "#0d7490", dark: "#21d3ee" },
    fuchsia: { light: "#c800de", dark: "#ed6aff" },
    amber: { light: "#b45307", dark: "#fbbf25" },
    red: { light: "#e7000b", dark: "#f0555a" },
    green: { light: "#15803d", dark: "#35d399" },
    orange: { light: "#c2410c", dark: "#fb923c" },
    teal: { light: "#0f766e", dark: "#2dd4bf" },
    indigo: { light: "#4f46e5", dark: "#818cf8" },
    pink: { light: "#db2777", dark: "#f472b6" },
    sky: { light: "#0369a1", dark: "#38bdf8" },
    yellow: { light: "#a16207", dark: "#facc15" },
    lime: { light: "#4d7c0f", dark: "#a3e635" },
    rose: { light: "#e11d48", dark: "#fb7185" },
    slate: { light: "#475569", dark: "#94a3b8" },
} as const satisfies Record<string, Shades>;

export type ColorFamily = keyof typeof COLOR_FAMILIES;

export const COLOR_FAMILY_NAMES = Object.keys(COLOR_FAMILIES) as ColorFamily[];

const HEX = /^#[0-9a-f]{6}$/;

/** A family, or an own color as `#rrggbb`. */
export const TaskColorValueSchema = z.union([
    z.enum(COLOR_FAMILY_NAMES as [ColorFamily, ...ColorFamily[]]),
    z.string().toLowerCase().regex(HEX, "A color is a family or #rrggbb"),
]);

export type TaskColorValue = z.infer<typeof TaskColorValueSchema>;

export const TaskColorsSchema = z.object({
    create: TaskColorValueSchema,
    edit: TaskColorValueSchema,
    pick: TaskColorValueSchema,
    filter: TaskColorValueSchema,
    warning: TaskColorValueSchema,
    destructive: TaskColorValueSchema,
    success: TaskColorValueSchema,
});

export type TaskColors = z.infer<typeof TaskColorsSchema>;

export const DEFAULT_TASK_COLORS: TaskColors = {
    create: "blue",
    edit: "violet",
    pick: "cyan",
    filter: "fuchsia",
    warning: "amber",
    destructive: "red",
    success: "green",
};

export interface ColorPreset {
    id: string;
    name: string;
    description: string;
    colors: TaskColors;
}

export const COLOR_PRESETS: ColorPreset[] = [
    { id: "default", name: "Default", description: "The colors DBackup ships with", colors: DEFAULT_TASK_COLORS },
    {
        id: "colorblind",
        name: "Colorblind friendly",
        description: "Delete and Success never red and green",
        colors: { create: "blue", edit: "pink", pick: "sky", filter: "indigo", warning: "yellow", destructive: "orange", success: "teal" },
    },
    {
        id: "soft",
        name: "Soft",
        description: "Calmer shades of the same meanings",
        colors: { create: "indigo", edit: "violet", pick: "teal", filter: "pink", warning: "amber", destructive: "rose", success: "green" },
    },
];

/** The preset a choice is, or null for one of a person's own. */
export function presetOf(colors: TaskColors): ColorPreset | null {
    return COLOR_PRESETS.find((preset) => TASK_COLOR_KEYS.every((key) => preset.colors[key] === colors[key])) ?? null;
}

export const isFamily = (value: TaskColorValue): value is ColorFamily => value in COLOR_FAMILIES;

// ------------------------------------------------------------------ color math

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
    const value = hex.replace("#", "");
    return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16) / 255) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
    return `#${rgb.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const fromLinear = (channel: number) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055);

/** A color as OKLCH, lightness 0 to 1, chroma and hue in degrees. */
function toOklch(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [lightness, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

function fromOklchRaw(lightness: number, chroma: number, hue: number): Rgb {
    const a = chroma * Math.cos((hue * Math.PI) / 180);
    const b = chroma * Math.sin((hue * Math.PI) / 180);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
}

/** Back to a hex color, with less chroma until it fits in sRGB. */
function fromOklch(lightness: number, chroma: number, hue: number): string {
    let current = chroma;
    for (let step = 0; step < 40; step++) {
        const rgb = fromOklchRaw(lightness, current, hue);
        if (rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005)) return rgbToHex(rgb.map(fromLinear) as Rgb);
        current *= 0.92;
    }
    return rgbToHex(fromOklchRaw(lightness, 0, hue).map(fromLinear) as Rgb);
}

function luminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast of two colors, 1 to 21. */
export function contrastRatio(first: string, second: string): number {
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}

/** What a color is read against: the white of the light theme and the cards of the dark one. */
export const THEME_SURFACES = { light: "#ffffff", dark: "#1a1a1c" } as const;

/** The text on a filled button of each theme in `globals.css`. */
const TEXT_ON = { white: "#fafafa", black: "#0f0f11" } as const;

/** A shade for the dark theme from an own color: the lighter tone of the same hue. */
export function darkShadeOf(hex: string): string {
    const [lightness, chroma, hue] = toOklch(hex);
    return fromOklch(Math.min(0.86, Math.max(0.72, lightness + 0.18)), Math.min(chroma, 0.19), hue);
}

/** The shades of a value in both themes. */
export function shadesOf(value: TaskColorValue): Shades {
    if (isFamily(value)) return COLOR_FAMILIES[value];
    return { light: value, dark: darkShadeOf(value) };
}

/** The text on a filled button of this color, whichever reads better. */
export function foregroundOf(hex: string): string {
    return contrastRatio(hex, TEXT_ON.white) >= contrastRatio(hex, TEXT_ON.black) ? TEXT_ON.white : TEXT_ON.black;
}

/** A darker shade for text on a light tint of the color, like the note of a delete dialog. */
export function textShadeOf(hex: string): string {
    const [lightness, chroma, hue] = toOklch(hex);
    return fromOklch(Math.max(0.3, lightness - 0.07), chroma, hue);
}

/** The variables a task sets, from its color in one theme. Only Delete has a text shade of its own. */
function varsOf(key: TaskColorKey, color: string, theme: keyof Shades): Record<string, string> {
    const vars: Record<string, string> = { [`--${key}`]: color, [`--${key}-foreground`]: foregroundOf(color) };
    if (key === "destructive") vars["--destructive-text"] = theme === "light" ? textShadeOf(color) : color;
    return vars;
}

/** The variables of a choice in one theme, for a preview that shows it before it is saved. */
export function taskColorVars(colors: TaskColors, theme: keyof Shades): Record<string, string> {
    return Object.assign({}, ...TASK_COLOR_KEYS.map((key) => varsOf(key, shadesOf(colors[key])[theme], theme)));
}

/**
 * The CSS that puts a choice on every page: the tasks that differ from the default, for the light
 * theme on `:root` and for the dark one on `.dark`. Empty for the default, so nothing is added.
 * Only families and `#rrggbb` values that passed the schema reach it, so nothing else lands in it.
 */
export function taskColorCss(colors: TaskColors): string {
    const changed = TASK_COLOR_KEYS.filter((key) => colors[key] !== DEFAULT_TASK_COLORS[key]);
    if (changed.length === 0) return "";
    const block = (theme: keyof Shades) =>
        changed.flatMap((key) => Object.entries(varsOf(key, shadesOf(colors[key])[theme], theme)).map(([name, value]) => `${name}:${value}`)).join(";");
    return `:root{${block("light")}}.dark{${block("dark")}}`;
}

/** A value as a person reads it, like Orange or #c2410c. */
export function colorName(value: TaskColorValue): string {
    return isFamily(value) ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}
