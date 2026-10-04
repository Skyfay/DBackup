/**
 * Lint Guard: no links to the retired adapter pages.
 *
 * Databases, storage and notification channels are configured on one page,
 * `/dashboard/connections`, with a `?tab=` selecting the section. The old
 * `/dashboard/sources`, `/dashboard/destinations` and `/dashboard/notifications` addresses
 * still work, but only as redirects in next.config.ts for bookmarks - nothing in the app
 * should link there.
 *
 * The guard exists because these paths were easy to miss: the OAuth callbacks alone
 * hard-coded the destinations page twenty times, and a missed one only shows up after a
 * user has already authorized their cloud account.
 *
 * Run with: pnpm test tests/unit/lint-guards/no-legacy-adapter-routes.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.resolve(__dirname, "../../../src");
const NEXT_CONFIG = path.resolve(__dirname, "../../../next.config.ts");

/** Each old address with the tab of the Connections page it leads to. */
const LEGACY_ROUTES: Record<string, string> = {
    "/dashboard/sources": "databases",
    "/dashboard/destinations": "destinations",
    "/dashboard/notifications": "notifications",
};

function collectFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectFiles(full, acc);
        else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
}

describe("Lint Guard: retired adapter routes", () => {
    it("nothing links to the old Sources, Destinations or Notifications pages", () => {
        const violations: string[] = [];

        for (const file of collectFiles(SRC_DIR)) {
            const relative = path.relative(SRC_DIR, file).replace(/\\/g, "/");

            fs.readFileSync(file, "utf-8").split("\n").forEach((line, index) => {
                for (const route of Object.keys(LEGACY_ROUTES)) {
                    // Bare path only - `/dashboard/sources` must not match a longer route
                    // that merely starts the same way.
                    if (new RegExp(`${route}(?![\\w-])`).test(line)) {
                        violations.push(`${relative}:${index + 1} → ${line.trim()}`);
                    }
                }
            });
        }

        expect(violations, violations.join("\n")).toEqual([]);
    });

    it("bookmarks of the old pages still lead to their tab, written out rather than read from a client module", () => {
        const config = fs.readFileSync(NEXT_CONFIG, "utf-8");
        for (const [route, tab] of Object.entries(LEGACY_ROUTES)) {
            expect(config, `${route} should redirect to its tab`).toContain(`{ source: "${route}", destination: "/dashboard/connections?tab=${tab}"`);
        }
    });

    it("no page stands in for an old address any more, a page there would win over the redirect", () => {
        for (const route of Object.keys(LEGACY_ROUTES)) {
            expect(fs.existsSync(path.join(SRC_DIR, "app", route, "page.tsx")), `${route}/page.tsx`).toBe(false);
        }
    });
});
