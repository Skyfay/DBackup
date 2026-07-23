/**
 * Lint Guard: no links to the retired adapter pages.
 *
 * Databases, storage and notification channels are configured on one page,
 * `/dashboard/connections`, with a `?tab=` selecting the section. The old
 * `/dashboard/sources`, `/dashboard/destinations` and `/dashboard/notifications` routes
 * still exist, but only as redirects for bookmarks - nothing in the app should link there.
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

/** The redirect stubs themselves, which necessarily know their own old path. */
const REDIRECT_STUBS = [
    "app/dashboard/sources/page.tsx",
    "app/dashboard/destinations/page.tsx",
    "app/dashboard/notifications/page.tsx",
];

const LEGACY_ROUTES = [
    "/dashboard/sources",
    "/dashboard/destinations",
    "/dashboard/notifications",
];

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
            if (REDIRECT_STUBS.includes(relative)) continue;

            fs.readFileSync(file, "utf-8").split("\n").forEach((line, index) => {
                for (const route of LEGACY_ROUTES) {
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

    it("the redirect stubs are still there for bookmarked links", () => {
        for (const stub of REDIRECT_STUBS) {
            const contents = fs.readFileSync(path.join(SRC_DIR, stub), "utf-8");
            expect(contents, `${stub} should redirect to the connections page`).toContain("/dashboard/connections");
        }
    });
});
