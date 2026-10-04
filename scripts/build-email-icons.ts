/**
 * Draws the pictures of the notification mails into docs/public/email, from the lists in
 * src/components/email/email-icons.ts. Run it after adding a pair there:
 *
 *   pnpm email:icons
 *
 * Every picture is drawn at twice the size the mail shows it, in a light and a dark color.
 * sharp comes with Next.js, so the script borrows it from there instead of adding a dependency.
 */
import { createRequire } from "module";
import fs from "fs/promises";
import path from "path";
import { ADAPTER_LOGOS, BANNER_ICONS, MUTED_ICONS, STATE_ICONS } from "../src/components/email/email-icons";
import { accentOf, DARK, LIGHT } from "../src/components/email/email-theme";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

const OUT = path.join(process.cwd(), "docs/public/email");
const THEMES = ["light", "dark"] as const;

type IconNode = [string, Record<string, string>][];

/** The shapes of a lucide icon. A renamed icon, like history, only points to the file of its new name. */
async function lucideNodes(name: string): Promise<IconNode> {
    const mod = await import(`lucide-react/dist/esm/icons/${name}.mjs`) as { __iconNode?: IconNode };
    if (mod.__iconNode) return mod.__iconNode;
    const source = await fs.readFile(require.resolve(`lucide-react/dist/esm/icons/${name}.mjs`), "utf8");
    const target = source.match(/from '\.\/([a-z0-9-]+)\.mjs'/)?.[1];
    if (!target) throw new Error(`No shapes for the lucide icon ${name}`);
    return lucideNodes(target);
}

async function lucide(name: string, color: string, px: number): Promise<string> {
    const body = (await lucideNodes(name))
        .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== "key").map(([key, value]) => `${key}="${value}"`).join(" ")}/>`)
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

async function iconify(pack: string, name: string, color: string | undefined, theme: string, px: number): Promise<string> {
    const mod = await import(`@iconify-icons/${pack}/${name}.js`) as { default: { body: string; width?: number; height?: number } };
    const { body, width = 24, height = 24 } = mod.default;
    // A one-color icon takes the color of the text, and the dark wordmark of AWS turns light in dark mode.
    const ink = color ?? (theme === "dark" ? DARK.fg2 : LIGHT.fg2);
    const painted = body.replaceAll("currentColor", ink).replaceAll("#252F3E", theme === "dark" ? "#e4e4e7" : "#252F3E");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${width} ${height}">${painted}</svg>`;
}

async function write(file: string, svg: string, px: number) {
    // Drawn four times larger and scaled down, so thin strokes keep smooth edges.
    const png = await sharp(Buffer.from(svg), { density: 72 * 4 }).resize(px, px).png({ compressionLevel: 9 }).toBuffer();
    await fs.writeFile(path.join(OUT, file), png);
}

async function main() {
    await fs.mkdir(OUT, { recursive: true });
    let count = 0;
    for (const theme of THEMES) {
        const dark = theme === "dark";
        for (const [tone, icons] of Object.entries(BANNER_ICONS)) {
            for (const icon of icons) {
                await write(`banner-${icon}-${tone}-${theme}.png`, await lucide(icon, accentOf(tone as keyof typeof BANNER_ICONS, dark), 36), 36);
                count++;
            }
        }
        for (const icon of MUTED_ICONS) {
            await write(`muted-${icon}-${theme}.png`, await lucide(icon, dark ? DARK.muted : LIGHT.muted, 32), 32);
            count++;
        }
        for (const [state, { icon, tone }] of Object.entries(STATE_ICONS)) {
            const color = tone === "faint" ? (dark ? DARK.faint : LIGHT.faint) : accentOf(tone, dark);
            await write(`state-${state}-${theme}.png`, await lucide(icon, color, 30), 30);
            count++;
        }
        for (const [adapterId, logo] of Object.entries(ADAPTER_LOGOS)) {
            await write(`adapter-${adapterId}-${theme}.png`, await iconify(logo.pack, logo.name, logo.color, theme, 36), 36);
            count++;
        }
    }
    process.stdout.write(`Wrote ${count} pictures to ${path.relative(process.cwd(), OUT)}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
});
