/**
 * Lint Guard: every page of the dashboard loads with its shape and names its tab.
 *
 * Without a loading.tsx a click in the sidebar leaves the old page standing until the server
 * answers, and without a title every tab, bookmark and history entry reads the same, and a
 * screen reader announces no move between pages. Both were missing on most pages.
 *
 * Run with: pnpm test tests/unit/lint-guards/dashboard-pages.test.ts
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const DASHBOARD = path.resolve(__dirname, "../../../src/app/dashboard");

function pages(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) pages(full, acc);
        else if (entry.name === "page.tsx") acc.push(full);
    }
    return acc;
}

const all = pages(DASHBOARD);
const name = (file: string) => path.relative(DASHBOARD, file);

describe("Lint Guard: the pages of the dashboard", () => {
    it("finds the pages", () => {
        expect(all.length).toBeGreaterThan(10);
    });

    it("each has a loading.tsx beside it, a skeleton of its shape", () => {
        const missing = all.filter((file) => !fs.existsSync(path.join(path.dirname(file), "loading.tsx"))).map(name);
        expect(missing, `Add a loading.tsx, like ListPageSkeleton from components/layout/page-skeletons.tsx:\n${missing.join("\n")}`).toEqual([]);
    });

    it("each names its tab with a title of its own", () => {
        const missing = all.filter((file) => !/export const metadata[^=]*=\s*\{\s*title:|export async function generateMetadata/.test(fs.readFileSync(file, "utf-8"))).map(name);
        expect(missing, `Export metadata with a title, the name the sidebar gives the page:\n${missing.join("\n")}`).toEqual([]);
    });
});
